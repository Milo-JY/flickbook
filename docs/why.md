# Why I built flickbook

*The code review I never got as a junior, for code your AI writes.*

[한국어](why.ko.md)

## Back then

At my first job I did have senior colleagues. They were busy, though, and being good at writing code is a different skill from being good at explaining it. How well people taught, and how much they wanted to, varied a lot from person to person.

So I often heard "this is wrong." What I rarely heard was why, or that the problem had a name: idempotency, input validation, a race condition. Without the name I couldn't even search for it. I had to dig everything up on my own, one piece at a time.

## Now

Today AI writes a lot of the code. It is faster, and more of that code gets accepted without anyone really reading it.

In a small, preliminary [Anthropic study](https://www.anthropic.com/research/AI-assistance-coding-skills), 52 mostly junior developers learned a new library. The group that used AI averaged 50% on a follow-up quiz, against 67% for those who coded by hand. The people who scored well used AI to understand the code, asking for explanations and conceptual questions, instead of only asking it to produce code.

The "move on without understanding" I went through as a junior is now easier for everyone. I wanted a tool that pushes the other way.

## What flickbook does about it

flickbook lets you flip through what your AI changed, one page at a time. For each step it shows the diff and an explanation in five parts: what you asked for, what it actually did, what differs (missing or not requested), where to check by hand, and the names of the concepts involved.

That last part is the one I wished I had back then: a name you can look up.

The explanations are written by an AI too, so they can be wrong. That is why every explanation points to places to check yourself. Treat it as a guide to what to read, not as the answer.

## Who I hope it helps

- **Juniors**: the "why" and the concept name right next to the change, so you can look it up on your own.
- **Seniors**: if more and more of your work goes through AI, the hands-on feel and the concepts you haven't used in a while start to fade. I hope stepping through the changes lets you meet those concepts again and follow the code by hand. The order of the explanation (asked, did, differs, check here) is also a way to explain code to someone else.
- **Teams**: when you need to walk colleagues through an AI-assisted change, you can share your screen and go through the replay one step at a time. The replay only runs on your own machine; flickbook does not share anything for you.

## A request

Please try it, and tell me where an explanation was wrong or a concept was missing. There is an issue form for exactly that. I would like to hear from people who were juniors, people who teach juniors, and people who now spend most of their day reading code an AI wrote.
