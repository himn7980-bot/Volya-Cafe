# Test signing key (NOT for the stores)

`iou-test.keystore` signs the APKs that `.github/workflows/iou-apk.yml` publishes as
GitHub Releases, so test builds can be installed over each other. Its password is in
the workflow on purpose: it is public, like Android's debug key.

Never use it for Google Play. Store builds are signed by EAS (`npx eas-cli build --profile production`).
