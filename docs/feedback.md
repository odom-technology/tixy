# Feedback tickets

Signed-in players submit feedback at `/feedback` and continue the private conversation at `/feedback/[id]`. Only the submitter and admins can read a ticket. Replies refresh while the ticket page is visible; the Refresh replies button checks immediately. Feedback reply notifications use the player's existing feedback-notification preference.

Admins use `/admin/feedback` to filter the queue, see the contact email, open conversations, and resolve tickets. The one status action changes from Resolve to Reopen when a ticket is closed. Resolving preserves the conversation; reopen before adding another reply. Formerly dismissed tickets appear as resolved and can be reopened. Old admin responses remain visible, and new replies are separate messages.

Guest submissions remain available for people who cannot sign in. Guests may supply a contact email, which is required for account, purchase, and privacy help. Guest submissions have no in-app conversation access; admins see the email for manual follow-up. Providing the same email from another account does not grant access to a ticket. The site does not automatically send email.

Contact email is visible only to admins. Older signed-in submissions without a stored email fall back to the linked account's email. Account tickets keep the contact email recorded at submission when present.

Migration `0077_feedback_conversations.sql` adds reply storage without changing existing tickets or notes. Replies update the ticket's position in the queue. A thread displays its latest 200 replies with an explicit notice if earlier replies exist; all replies remain stored.

## Local verification

Use a disposable PostgreSQL database, run `npm run db:migrate`, and start the app on loopback. Configure `ARCADE_ADMIN_EMAILS=feedback-admin@example.com` before starting it. Use an HTTP `NEXT_PUBLIC_APP_URL` matching the test origin, including the port, so local production-mode session cookies work.

Then run the following with three unused synthetic addresses:

```sh
FEEDBACK_QA_BASE_URL=http://127.0.0.1:3219 \
FEEDBACK_QA_OWNER_EMAIL=feedback-owner@example.com \
FEEDBACK_QA_OTHER_EMAIL=feedback-other@example.com \
FEEDBACK_QA_ADMIN_EMAIL=feedback-admin@example.com \
FEEDBACK_QA_PASSWORD='LocalFeedbackOnly!2026' \
npm run test:feedback-conversations
```

The verifier rejects public targets and checks owner/admin conversations, unrelated-account isolation, contact privacy, validation, notifications, guest handling, and resolution/reopening. It creates local fixtures; discard that database afterward. Run lint, typecheck, and the production build locally. This test does not change GitHub Actions triggers.
