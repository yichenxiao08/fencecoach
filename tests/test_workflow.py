from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from pydantic import ValidationError

from fencecoach.api import app
from fencecoach.coach.graph import EvidenceValidationError, run_coach, validate_citations
from fencecoach.repository import Repository
from fencecoach.schemas import CoachingReport, CoachRequest, MetricObservation, SessionCreate
from fencecoach.settings import settings

SAMPLE = Path(__file__).parents[1] / "src/fencecoach/web/sample-session.json"


def session_data():
    return SessionCreate.model_validate_json(SAMPLE.read_text(encoding="utf-8-sig"))


def request():
    return CoachRequest(
        session_id="test-session",
        question="Review my recovery time",
        metrics=session_data().metrics,
    )


class DataAndEvidenceTests(unittest.TestCase):
    def test_duplicate_metric_ids_and_reversed_timestamps_are_rejected(self):
        data = session_data().model_dump()
        data["metrics"].append(data["metrics"][0])
        with self.assertRaises(ValidationError):
            SessionCreate.model_validate(data)
        data["metrics"] = [data["metrics"][0]]
        data["metrics"][0]["end_ms"] = 1
        with self.assertRaises(ValidationError):
            SessionCreate.model_validate(data)

    def test_nonfinite_numbers_are_rejected(self):
        data = request().metrics[0].model_dump()
        data["value"] = float("nan")
        with self.assertRaises(ValidationError):
            MetricObservation.model_validate(data)

    def test_unknown_and_wrong_type_citations_are_rejected(self):
        report = CoachingReport.model_validate(
            {
                "summary": "Test",
                "observations": [
                    {
                        "claim": "A measurement",
                        "evidence": [
                            {
                                "source_type": "knowledge",
                                "source_id": "rep-01-recovery",
                                "note": "Invalid type",
                            }
                        ],
                    },
                ],
            }
        )
        with self.assertRaises(EvidenceValidationError):
            validate_citations(report, {"rep-01-recovery"}, set())

    def test_demo_executes_real_graph_without_aws(self):
        with (
            patch.object(settings, "bedrock_chat_model_id", ""),
            patch(
                "fencecoach.rag.knowledge.get_knowledge_store", side_effect=AssertionError("No AWS")
            ),
        ):
            run = run_coach(request())
        self.assertEqual(run.mode, "demo")
        self.assertEqual(run.input_tokens + run.output_tokens, 0)
        self.assertTrue(run.citation_ids_valid)
        self.assertGreater(run.citation_count, 0)
        self.assertIn("validate_citations", [event.step for event in run.trace])
        self.assertIsNotNone(run.report.next_drill)

    def test_low_confidence_only_session_produces_no_drill(self):
        data = request()
        for metric in data.metrics:
            metric.confidence = 0.2
        run = run_coach(data)
        self.assertIsNone(run.report.next_drill)
        self.assertTrue(all("too low" in item.claim for item in run.report.observations))

    def test_live_tool_loop_is_bounded_and_tokens_accumulate(self):
        class LoopModel:
            calls = 0

            def bind_tools(self, tools):
                return self

            def with_structured_output(self, schema, include_raw):
                class Formatter:
                    def invoke(self, messages):
                        return {
                            "parsed": CoachingReport(
                                summary="Insufficient evidence", limitations=["Test"]
                            ),
                            "raw": AIMessage(
                                content="",
                                usage_metadata={
                                    "input_tokens": 5,
                                    "output_tokens": 2,
                                    "total_tokens": 7,
                                },
                            ),
                        }

                return Formatter()

            def invoke(self, messages):
                self.calls += 1
                return AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "compare_to_baseline",
                            "args": {"metric_name": "recovery"},
                            "id": f"call-{self.calls}",
                        }
                    ],
                    usage_metadata={"input_tokens": 10, "output_tokens": 3, "total_tokens": 13},
                )

        model = LoopModel()
        with patch.object(settings, "bedrock_embedding_model_id", ""):
            run = run_coach(request(), mode="bedrock", model=model)
        self.assertEqual(model.calls, 3)
        self.assertEqual(run.input_tokens, 35)
        self.assertEqual(run.output_tokens, 11)

    def test_provider_report_with_invented_source_is_rejected(self):
        class InvalidModel:
            def bind_tools(self, tools):
                return self

            def invoke(self, messages):
                return AIMessage(content="Done")

            def with_structured_output(self, schema, include_raw):
                class Formatter:
                    def invoke(self, messages):
                        return {
                            "raw": AIMessage(content=""),
                            "parsed": CoachingReport.model_validate(
                                {
                                    "summary": "Bad",
                                    "observations": [
                                        {
                                            "claim": "Invented",
                                            "evidence": [
                                                {
                                                    "source_type": "knowledge",
                                                    "source_id": "made-up",
                                                    "note": "Bad",
                                                }
                                            ],
                                        }
                                    ],
                                }
                            ),
                        }

                return Formatter()

        with (
            patch.object(settings, "bedrock_embedding_model_id", ""),
            self.assertRaises(EvidenceValidationError),
        ):
            run_coach(request(), mode="bedrock", model=InvalidModel())


class ApiPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "sessions.sqlite3"
        self.repo = Repository(self.path)
        self.patch = patch("fencecoach.api.repository", self.repo)
        self.patch.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.patch.stop()
        self.temp.cleanup()

    def test_session_report_roundtrip_survives_new_repository(self):
        response = self.client.post("/api/sessions", json=session_data().model_dump())
        self.assertEqual(response.status_code, 201)
        session_id = response.json()["session_id"]
        response = self.client.post(
            f"/api/sessions/{session_id}/reports",
            json={
                "question": "What changed in my recovery?",
                "mode": "demo",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        run = response.json()
        reopened = Repository(self.path)
        self.assertEqual(reopened.get_session(session_id).title, session_data().title)
        self.assertEqual(reopened.get_run(run["run_id"]).report.summary, run["report"]["summary"])
        self.assertEqual(len(reopened.list_runs(session_id)), 1)
        self.assertEqual(self.client.get("/api/reports/" + run["run_id"]).status_code, 200)

    def test_missing_session_and_bad_import_are_rejected(self):
        self.assertEqual(self.client.get("/api/sessions/missing").status_code, 404)
        self.assertEqual(
            self.client.post("/api/sessions", json={"title": "Missing metrics"}).status_code, 422
        )
        self.assertEqual(
            self.client.post(
                "/api/sessions/missing/reports",
                json={
                    "question": "Review",
                    "mode": "demo",
                },
            ).status_code,
            404,
        )

    def test_failed_live_configuration_saves_no_report(self):
        session_id = self.client.post("/api/demo").json()["session_id"]
        with patch.object(settings, "bedrock_chat_model_id", ""):
            response = self.client.post(
                f"/api/sessions/{session_id}/reports",
                json={
                    "question": "Review recovery",
                    "mode": "bedrock",
                },
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.repo.list_runs(session_id), [])

    def test_dashboard_and_assets_are_served(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/static/app.js").status_code, 200)
        self.assertEqual(self.client.get("/static/sample-session.json").status_code, 200)
        self.assertTrue(self.client.get("/health").json()["status"] == "ok")


if __name__ == "__main__":
    unittest.main()
