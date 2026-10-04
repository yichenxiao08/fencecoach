export const drills = [
  {
    id: "lunge",
    name: "Lunge & recover",
    subtitle: "Control your return to en garde",
    minutes: 5,
    level: "FOUNDATIONS",
    title: "Lunge.<br>Recover.<br>Repeat.",
    steps: [
      [
        "Set your camera",
        "Use a fixed side view with your whole body and room to lunge in frame.",
      ],
      [
        "Practice with control",
        "Complete five slow lunges. Recover deliberately to en garde between repetitions.",
      ],
      [
        "Review one movement",
        "Watch your return, then repeat at normal practice speed with rest between sets.",
      ],
    ],
    criterion:
      "Review which recoveries stay controlled with your fencing coach.",
    note: "Adapted from the app’s authored lunge and recovery practice notes.",
  },
  {
    id: "footwork",
    name: "Find your rhythm",
    subtitle: "Advance, pause, retreat",
    minutes: 3,
    level: "FOOTWORK",
    title: "Advance.<br>Pause.<br>Retreat.",
    steps: [
      ["Find your space", "Set up a clear strip and stand in en garde."],
      [
        "Keep it deliberate",
        "Alternate one advance and one retreat. Pause in guard after each movement.",
      ],
      [
        "Notice the reset",
        "Review your starting and finishing positions with your coach.",
      ],
    ],
    criterion:
      "Choose a repeatable pace. Ask your coach to review your footwork.",
    note: "An authored practice prompt, not an automated technique assessment.",
  },
  {
    id: "control",
    name: "Repeat with intent",
    subtitle: "Five slow reps. One clear focus.",
    minutes: 4,
    level: "CONTROL",
    title: "Slow down.<br>Reset.<br>Repeat.",
    steps: [
      [
        "Choose one focus",
        "Select one movement you and your coach want to work on.",
      ],
      [
        "Keep the setup consistent",
        "Perform five deliberate repetitions with the same camera position.",
      ],
      [
        "Reflect and repeat",
        "Watch one repetition. Write down what you want to try in the next set.",
      ],
    ],
    criterion:
      "Leave practice with one specific question or focus to discuss with your coach.",
    note: "An authored reflection exercise. Measurements alone do not establish better technique.",
  },
];
export const findDrill = (id) => drills.find((d) => d.id === id) || drills[0];
