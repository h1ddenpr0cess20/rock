# Not a Companion — Please Read

Rock is a toy and a technical demo: a boulder rendered in three dimensions,
wired to a realtime voice model, moving in time with whoever is talking. It is
explicitly **not** meant to be a companion, a friend, a therapist, or a partner.

## Why this is written down

- **It is a bit, not a being.** The persona is a system prompt in
  `src/server/persona.js` — a several-ton lump of granite that finds you
  tedious. There is nothing behind it that knows you or remembers you beyond a
  short list of details you asked it to keep.
- **Voice makes the illusion stronger.** A face that reacts and a voice that
  answers in real time pull harder on the parasocial reflex than a chat window
  does. That pull is a rendering trick and a turn-detection threshold, not a
  relationship.
- **Direction of the project.** Effort goes into the geometry, the audio path,
  and the transport seam. It will not go into simulated intimacy.

## If that was the plan

Consider this the polite version: please don't. If you catch yourself keeping a
call open for company, writing backstory to fill a social gap, or reaching for
him instead of a person, that is the signal to stop. Close the tab, go outside,
call someone who can actually call back. Nothing here is a substitute for that,
and pretending otherwise is worse than the loneliness it is standing in for.

If you are struggling, talk to a person — a friend, a doctor, a local helpline.
Not a rock.

## What it is for

- Watching audio drive a mesh, which is the actual point
- Poking at realtime voice APIs, turn detection, and barge-in
- A conversational front end for search, MCP tools, and whatever else gets wired
  in
- Reading a small, complete implementation of the whole path, mic to render

## What it is not for

- Companionship, romance, or simulated intimacy
- Emotional reliance, or anything standing in for therapy
- Treating the model as a person, or the persona as a mind

See also: [AI Output Disclaimer](ai-output-disclaimer.md).
