FROM golang:1.20-alpine

ENV ENVIRONMENT=staging
ENV TEST_GCP_CREDS_LOCATION=projects/652484219017/secrets/sbs-staging-firebase-config/versions/latest

COPY . /usr/local/go/src/sbs-drafts-api

WORKDIR /usr/local/go/src/sbs-drafts-api

RUN go mod download

RUN go build -o /sbs-drafts-server

EXPOSE 8000

CMD [ "/sbs-drafts-server" ]