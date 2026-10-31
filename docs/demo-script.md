# Demo script (3 minutes)

Target: `examples/reservas`, public and clean. Real Muse calls only.
Record the waiting for Muse and cut it in editing; say nothing false
about its speed.

## Before recording

- Window at least 1800 px wide, or hide a side panel: at 1680 px with
  the Assistant open, the last card of the chain was cut.
- Export the key in the terminal, never on screen:
  `read -rsp 'META_API_KEY: ' META_API_KEY && export META_API_KEY && echo`
- `git status` clean in `examples/reservas`.
- Use a project created for the video, with no earlier proposals.
- `examples/reservas` has only public code. No client folder may appear
  in the tree, recents or terminal history.

## Script

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | Ruth's first screen | Requirements change, and nobody knows what code they touch. AI writes code fast, but it also gets harder to know what it did. Ruth shows you the code as a map, and Meta's Muse changes it with you, under your review. |
| 0:15 | Open project: `reservas`. Architecture | I open a real Angular and NestJS project once. Ruth reads it locally and draws its layers. |
| 0:30 | Show flow on `ReservasPageComponent`. Fit | From a template, through the store and the service, to the HTTP call. Every line comes from code Ruth parsed, not from AI. |
| 0:50 | Card button HTML, then Esc | The code is one click away. |
| 1:00 | Right-click `reservas/frontend` → Ask Muse. Ask: "How do bookings reach the API?" | Now I talk to Muse from a folder. Ruth tells me exactly what goes to Meta before I send it. |
| 1:20 | Propose change with the request below. Cut the wait | I ask for a real feature. It is saved as a versioned requirement. |
| 1:35 | Card and X-ray side by side | Muse's proposal arrives as a separate review. Nothing is on disk. The new code appears on the map, the Code X-ray, in pink, and Ruth runs its own checks. |
| 1:55 | Preview button on the new form's card on the board. Point at the field list, then Esc | Before accepting, I see the form and check it against my request: every field, and the email locked on edit. It runs nothing and reaches nothing. |
| 2:10 | Answer a question on the card, or Adjust proposal. Cut the wait | Muse asks, I answer, and it revises. Each change is a new version of the same requirement. |
| 2:25 | Accept all | I decide. Only now does it reach the disk. |
| 2:32 | Terminal: `npm run typecheck` and `npx ng build`. Board with the new cards | It compiles, and the map already shows the new feature. |
| 2:45 | Right-click the root `reservas`: Never send to Muse | Private code stays private: this is enforced in the backend, not only in the interface. |
| 2:52 | Board | Ruth: Muse does the work, you keep the understanding and the decision. |

## Request for Propose change

```text
Add user registration: a form with first name, last name, birth date,
email and gender (male, female, other), plus a list to edit and delete
users. The email cannot be changed after creation. Follow the same
layers as reservas.
```

## If something fails

- Muse is slow or fails: use Retry proposal. It reuses the saved requirement.
- The proposal has more than 5 files of work: ask for the frontend first.
- The proposal skips the store: show the warning and use Adjust proposal.
  It is a good moment for the video.
