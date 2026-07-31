# Luna work board

`board.json` is the source of truth for the Luna agent queue rendered at
`/admin/luna`.

## Worker contract

1. Claim only a ticket whose `status` is `ready` and whose `blockedBy` tickets
   are all `done`.
2. Change its status to `active` and set `assignee` to the working Luna role in
   the same commit that starts the work.
3. Work only the ticket's stated scope. Its `acceptanceCriteria` are the
   definition of done.
4. Move the ticket to `review` with an evidence link after all acceptance checks
   pass.
5. A validator moves it to `done`. Workers do not self-approve.

Tickets marked `humanGate: true` require access, a decision, or authority that
an agent cannot manufacture. Luna can prepare evidence and options, but the
ticket stays blocked until the named gate is actually cleared.

## Status meanings

- `ready` — unblocked and safe for the next available worker.
- `active` — one Luna worker owns the ticket now.
- `review` — implementation is complete and awaiting validation or merge.
- `blocked` — a dependency or human gate is still open.
- `done` — acceptance criteria have been independently verified.

When repository or deployment state changes, update the snapshot date,
`sourceNote`, relevant ticket status, and evidence in the same change.
