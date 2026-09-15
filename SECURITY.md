# Security

## Design

Script Glow is a single-user app that runs on your own computer. It has no accounts or passwords.

- The app listens on `127.0.0.1` only and rejects requests from other sites and hosts.
- The voice server also listens on `127.0.0.1` by default.
- Scripts, recordings, and backups stay on your disk. They go only to the voice and AI services you configure.
- Imported scripts and backups are treated as untrusted: sizes are limited, text is escaped, and PDFs are read in a separate process with memory and time limits.

Do not expose either server to a network. There is no login to protect it.

## Reporting a vulnerability

Please report it privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Do not open a public issue. Include the steps to reproduce and the version or commit.

Only the latest release receives fixes.
