# Boris: Need the draft-actions Cloud Run URL

Run this:
```bash
gcloud run services list --project sbs-test-env --region us-central1
```

Find the service that handles `/draft-actions/` and paste the URL here or push it to your branch.

If you're not sure which service, try:
```bash
gcloud run services describe sbs-draft-actions --project sbs-test-env --region us-central1 --format="value(status.url)"
```

Or just list all services and I'll figure out which one:
```bash
gcloud run services list --project sbs-test-env --region us-central1 --format="table(metadata.name, status.url)"
```

Once I have the URL, it's a 1-line frontend fix to make Draft button work with REST picks.
