FROM golang:1.20-alpine

ENV GOOGLE_APPLICATION_CREDENTIALS=./configs/sbs-test-env-config.json
ENV ENVIRONMENT=dev
ENV TEST_GCP_CREDS_LOCATION=projects/1026708014901/secrets/sbs-test-env-config/versions/latest
ENV TEST_DRAFT_SERVER_BASE_URL=https://sbs-drafts-server-ajuy5qy3wa-uc.a.run.app
ENV TEST_RT_DB_URL=https://sbs-test-env-default-rtdb.firebaseio.com
ENV GCP_PROJECT_ID=sbs-test-env
ENV GCP_LOCATION=us-central1
ENV CLOUD_TASKS_QUEUE_NAME=auto-draft-queue
ENV DEV_API_URL="https://sbs-drafts-api-1026708014901.us-central1.run.app"
ENV INFURA_API_KEY="0d15d12afb094dbe97df37f8b62d6c96"
# OneSignal SMS (notifications/onesignal). Empty = SMS sends no-op.
# Set via: gcloud run services update <service-name> --set-env-vars=ONESIGNAL_APP_ID=...,ONESIGNAL_REST_API_KEY=...
ENV ONESIGNAL_APP_ID="b7e8d393-68de-4cde-94e3-d013f35a4d25"
ENV ONESIGNAL_REST_API_KEY="os_v2_app_xxoktv4ol5falaj26b7czeduqlkyxmot3pduxsedypntmahyfpus45hifrzpx2fdjmmtiqsxlob5cphez7ho46hsknixll4f67jpuhi"

# Cache bust to force rebuild with staging routes
ARG CACHEBUST=2026-05-22-leave-fix

COPY . /usr/local/go/src/sbs-drafts-api

WORKDIR /usr/local/go/src/sbs-drafts-api

RUN go mod download

RUN go build -o /sbs-drafts-api

COPY ./configs/sbs-test-env-config.json ./configs/sbs-test-env-config.json

EXPOSE 8080

CMD [ "/sbs-drafts-api" ]
