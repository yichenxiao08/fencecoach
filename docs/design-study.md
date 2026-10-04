# FenceCoach design study

## Research

Reviewed HomeCourt's [official product site](https://www.homecourt.ai/) and [published App Store screens](https://apps.apple.com/us/app/homecourt-basketball-training/id1258520424). This is a study of published material, not a hands-on review of the installed app. The dated screenshots should not be assumed to represent every current screen.

Patterns adapted for fencing: make starting practice obvious; use visual activity cards; keep footage central during review; make key measurements easy to scan; give practice and progress a clear place in the navigation. The interpretation below is original to FenceCoach.

## Three directions

| Direction | Visual approach | Main experience | Tradeoff |
| --- | --- | --- | --- |
| Piste | White, red, condensed athletic type, large photography | Choose a drill and start practice | More energetic and visually dense |
| Replay Studio | Charcoal, red, large footage and precise metrics | Select a repetition and understand one takeaway | Strong review experience, less welcoming as a home screen |
| Training Journal | Ivory, terracotta, serif headings, quiet spacing | Set one daily intention and build a practice habit | Less emphasis on the technical analysis |

**Recommendation:** use Piste's home and drill discovery, with Replay Studio's immersive review. Keep the navigation and camera flow consistent. Borrow the journal's emphasis on one focus per session.

The selected direction is now the working app at `/`: Piste training, dark Replay Studio review and coaching, and a journal section for real imported practice history. The palette has been updated to fencing-strip red, with green used for completion. The standalone prototypes below remain illustrative comparison artifacts.

## Clickable flows

- Training → drill details → camera setup → simulated practice → review.
- Review → select repetition, toggle landmarks, cycle sample reps, expand evidence → session coach.
- Coach → baseline comparison, drill suggestion, confidence explanation, or free text.
- Progress → weekly/monthly sample totals and practice history.

The gallery supports `concept=piste|studio|journal`, `screen=home|drill|record|review|progress|coach`, and `focus=1` for a full phone preview. `prototypes-compare.html` embeds all three previews side by side on desktop and vertically on smaller screens.

## Implementation boundary

These are static frontend design prototypes served by the existing FastAPI app. They do not call the coaching API. The photo is generated, landmarks are illustrative, metrics are synthetic, and responses are scripted. Playback cycles selected repetitions over a still image. Camera access and real video analysis are not implemented here. The working dashboard remains accessible at `/`.

The UI keeps the LLM experience contextual: ask about the selected rep, expand the measurement behind a cue, and turn a question into a next practice action. The actual LangGraph, tools and RAG backend can be connected after choosing a direction; model or orchestration names do not need to appear in the athlete's navigation.

## Original visual asset

Tool: built-in `image_gen.imagegen`. Asset: [`fencing-editorial.png`](../src/fencecoach/web/fencing-editorial.png), used across the three concepts. It depicts an illustrative adult athlete, not user footage.

Final generation prompt:

> Use case: photorealistic-natural. Asset type: original wide sports photography banner for a fencing training app prototype. Create a cinematic editorial sports photograph in a fencing salle: a single adult foil fencer in full white protective uniform and a black mesh mask executing a deep but realistic right-facing lunge on a narrow metallic piste, entire body and both feet visible, foil arm extended to the right with blade visible. Subject occupies right two thirds, left third dark uncluttered usable negative space. Quiet charcoal club background, tall soft window light, authentic worn floor texture, striking white kit, crisp motion frozen with subtle background depth. Landscape composition approximately 3:2, premium athletic campaign photography, realistic anatomy and fencing equipment. No text, UI, logos, watermarks, other people, additional limbs, or branded equipment. This is illustrative imagery, not real user footage.
