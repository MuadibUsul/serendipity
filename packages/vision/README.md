# Vision features and aesthetic references (P02-07)

`createVisionService` turns a person's private matching photo into three coarse observations:
hair length, clothing style and photo style, each with a confidence from 0 to 1. The model receives
a strict JSON schema; the service independently rejects extra keys, free text, sensitive identity
or personality claims, and out-of-range values. It stores no model explanation, face embedding,
attractiveness score or raw image. Aesthetic reference photos use the same private upload flow; the
person explicitly marks each reference `like` or `dislike`. The model never infers that preference.

Processing requires both the person's live photo-processing grant and their visual-matching grant.
Matching reads check the grant again and return only snapshots backed by active, unexpired photos.
Revocation or disabling the feature stops new model calls and matching reads immediately; the
media cleanup job removes stored feature rows when it deletes the photo. An already running model
call checks consent and asset status again before writing. No cross-user photo URL is issued.

The service defaults to disabled. There is no public API route until G1 approval, authenticated
user ID plumbing, a vetted model provider and private S3/KMS deployment are ready. The optional
`openAiVisionProvider` uses the Responses API with an image URL, strict structured output and
`store: false`; supply the model and API key from managed configuration. It does not make a call
until the service gates pass. OpenAI's [image input](https://developers.openai.com/api/docs/guides/images-vision)
and [structured output](https://developers.openai.com/api/docs/guides/structured-outputs)
documentation describes the request shape. Provider data handling and deployment region require
review before real photos are enabled.
