# API management and task routes

`electron/api-management.cjs` defines the configuration format and provider catalogue.
`electron/task-routing.cjs` resolves a task to one configuration or the built-in local
service. Neither module starts a network request.

## Persisted configuration

`state.apiManagement` contains `version: 1`, `defaultConfigId`, `configs`, and
`taskRoutes`. Configuration rows keep `id`, `name`, `providerId`, `protocol`,
`base`, `model`, `capabilities`, non-secret `fields`, and `credentialId`.
Existing `profiles` are projected into this list with their original IDs. The
legacy editor and conversation history are retained. Explicit vision capability
requires a user declaration; an old chat profile does not acquire it by migration.

Routes use one of a configuration ID, `inherit`, `builtin-local`, or `unassigned`.
The ASR and vision routes default to `unassigned`; TTS defaults to built-in local.
Other text tasks inherit the default chat configuration. A provider's declared
capability permits the protocol, but does not verify a particular model.

## Secrets and validation

Secrets are not configuration fields. The main process saves the result of
`encryptCredentialRecord()` in the existing `keys.json`, through its existing
serialized write queue and operating-system `safeStorage` checks. Single API keys
retain compatibility with the old encrypted-key record; providers with several
secret fields use an encrypted JSON envelope. Decryption checks the endpoint
origin binding. For Alibaba ASR the binding uses the adapter's strict region and
workspace endpoint selector.

A duplicate receives a new credential ID. The main process may copy the encrypted
record to this new ID, but must clear its validation records. Deletion resets
routes that referenced the removed configuration; `unusedCredentialIds()` identifies
records no remaining configuration references. Saving a new secret at an existing
credential ID must clear validation for every configuration that uses that ID.

Store validation in a main-process-owned file, not in renderer-supplied state.
`credentials`, `models`, `connection`, `vision`, and `stream` are independent
results. The validation fingerprint includes the provider, model, destination,
configuration fields and declared capabilities. A changed configuration invalidates
all old results. Model discovery cannot mark chat, image or audio execution passed;
a WebSocket handshake cannot mark actual transcription passed.

## ASR provider catalogue

All providers start with validation `untested`. Alibaba's adapter is marked
`implemented-unverified`; the other entries are `catalog-only` and execution is
blocked until their adapter exists. User-facing fields and tutorials are metadata,
not an assertion that a provider has been tested with a real account.

The following primary documentation was checked on 2026-10-30:

| Provider | Official reference | Configured authentication / protocol |
| --- | --- | --- |
| OpenAI | https://developers.openai.com/api/docs/guides/realtime-transcription | API key and model; catalogue only |
| Alibaba Model Studio | https://www.alibabacloud.com/help/en/model-studio/qwen-asr-realtime-interaction-process | Bearer API key, matching region/workspace; Qwen realtime session protocol |
| Volcengine Doubao | https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh | New `X-Api-Key` and resource ID; catalogue only |
| Tencent Cloud | https://cloud.tencent.com/document/api/1093/48982 | APPID, SecretID and SecretKey signature; catalogue only |
| Deepgram | https://developers.deepgram.com/reference/speech-to-text/listen-streaming | Token key, model/language; catalogue only |
| ElevenLabs | https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime | `xi-api-key`, Scribe model and commit strategy; catalogue only |
| Google Cloud extension | https://docs.cloud.google.com/speech-to-text/docs/v1/transcribe-streaming-audio | Streaming gRPC and Application Default Credentials; not integrated |
| Azure Speech extension | https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-speech-to-text | Resource key, region/endpoint and Speech SDK; not integrated |

No OpenAI transcription transport is added by these modules. Physical microphone,
remote-account billing, real transcription quality and latency remain separate tests.
