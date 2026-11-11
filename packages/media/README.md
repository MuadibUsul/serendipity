# Private matching photos (P02-06)

`createMediaService` implements the server-side photo lifecycle. Upload and read calls are off by
default; pass `realPhotosEnabled: true` only after G1 approval and after an authenticated route
supplies the verified user ID. No public photo endpoint is registered yet, because the API has no
user authentication module. Identity verification images have a separate purpose and are refused
here; they must use their own consent policy and storage path.

For each upload, the service checks the current `visual_matching` grant and creates an opaque
`photos/<uuid>` key. `s3PrivateMediaStorage` returns a 60-second presigned POST policy constrained
to one key, content type, maximum size (10 MiB), SSE-KMS and one KMS key. Completing the upload
waits until the POST policy expires, then checks the object metadata and image signature before activation; the
uploader cannot overwrite the verified object. Vision reads get a 60-second signed GET only after
a fresh consent check. A previously issued GET may remain usable until its 60-second expiry.

The S3 bucket must have **Block Public Access** enabled, a private bucket policy, TLS-only access,
versioning disabled or noncurrent-version expiry, and an IAM role limited to this bucket's
`photos/*` and `derived/*` prefixes. Its KMS policy must allow only that role. Do not add a public
ACL or CDN origin. The SDK uses the deployment role's default AWS credentials; no key is stored
in the repository. The bucket and KMS key are supplied as `MEDIA_BUCKET`, `MEDIA_KMS_KEY_ID`, and
`AWS_REGION`.

Schedule `npm run media:cleanup` at least once per minute in each environment. It scans pending
and active assets: pending uploads older than five minutes, expired assets and assets whose
`visual_matching` grant was revoked are deleted from storage. Registered derived objects in
`app.media_derivatives` are deleted first, then their rows and the primary object. Repeated runs
are safe. Future vision code must register every derived object in that table before exposing it.
There is no real-user upload path until G1 approval and authentication are wired in.
