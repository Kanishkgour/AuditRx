# LekhaRx frontend preview

This folder contains the standalone frontend preview for the LekhaRx clinical document workflow.

Open `login.html` in a browser to start the flow:

1. Sign in
2. Capture or choose a document on `index.html`
3. Review and approve the extraction on `review.html`
4. Inspect and export the audit history on `audit.html`

The preview uses browser-only behavior. Selected files are not uploaded; the review and audit steps use sample clinical data and local browser storage so the experience can be tested before the MERN API is connected.
