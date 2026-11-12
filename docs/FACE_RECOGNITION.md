# Face recognition attendance

## What runs where

```
Camera ──▶ [device] Human (WebGL/WASM)                                         [server] Postgres
            1. BlazeFace detection + 468-point FaceMesh + iris   ─┐
            2. Quality gate: one face, size, centring, pose,      │
               brightness, detector confidence                    │  embedding (FaceRes descriptor, averaged over 4+ good frames)
            3. Active challenge: randomised blink + head turn     ├─▶ anti-spoof & liveness scores (median)
               both ways (blink = EAR drop & recovery < 1.2 s)    │   challenge result, quality
            4. Passive anti-spoofing + liveness models per frame  │
            5. Identity continuity: face at the end must match    ┘──▶ face_clock() / kiosk_identify_clock()
               the face that started the challenge                      ├ rate limit (failed attempts / hour)
                                                                       ├ consent check
                                                                       ├ thresholds: anti-spoof, liveness, challenge
                                                                       ├ similarity vs enrolled templates (mean of top 3)
                                                                       ├ log every attempt (no images)
                                                                       └ record punch with server time + attendance rules
```

* **Library**: [`@vladmandic/human`](https://github.com/vladmandic/human) (MIT, maintained). Models are served from your own origin (`/models`, copied at install) — no third‑party calls at runtime.
* **No images leave the device.** Only a numeric descriptor and scores are sent.
* **Templates never leave the server.** `face_templates` has RLS enabled with zero policies; matching happens inside `SECURITY DEFINER` functions.

## Enrolment (HR, in person)

1. Record the employee's written consent (*Record consent*) — or the employee consents in self‑service.
2. **Enrol** runs the same liveness challenge, then captures 5+ samples (configurable) while prompting small pose changes (straight, slight left/right, chin up).
3. Every sample must pass the quality gate and anti‑spoofing; all pairs of samples must match each other (consistency check) or the enrolment is rejected and retaken.
4. Templates are stored per model id (`human-faceres-v1`). Re‑enrolment replaces them.

## Verification modes

| Mode | Who | Matching |
|---|---|---|
| Self check‑in (`face_clock`) | Signed‑in employee on their phone/PC | 1:1 against their own templates |
| Kiosk (`kiosk_identify_clock`) | Shared supervised device signed in with a `kiosk` role account | 1:N across the organisation; rejected if the best and second‑best candidates are within 0.05 (ambiguous) |
| Test match (`face_test_match`) | HR | Reports the similarity without punching — use it to calibrate |

## Thresholds and calibration

*Administration › Integration Settings* (stored in `company_settings`):

| Setting | Default | Meaning |
|---|---|---|
| `face_match_threshold` | 0.60 | Human’s normalised similarity (vendor guidance: > 0.5 is the same person). We default stricter. |
| `face_antispoof_threshold` | 0.50 | Minimum median anti‑spoof score |
| `face_liveness_threshold` | 0.50 | Minimum median liveness score |
| `face_min_samples` | 5 | Samples required at enrolment |
| `face_max_attempts_per_hour` | 10 | Failed attempts before lockout |

**Calibrate before go‑live**: enrol 10–20 people, then use *Test match* (same person, different days and lighting, with and without glasses) and record scores; also test a few different people against each enrolment. Set the threshold between the two distributions, closer to the impostor side being rejected. The recognition log shows every score for later review.

## Threat model — what this does and does not stop

Stops or strongly deters:
* Printed photos and phone/tablet screens (passive anti‑spoof model + active blink/turn + identity continuity).
* Pre‑recorded videos (random challenge order, both‑direction turn, timing limits on blinks).
* Buddy punching on a shared kiosk (1:N with ambiguity rejection, logs).
* Brute force (per‑employee hourly rate limit) and replay of an already‑used offline punch (idempotency key).

Known limitations — be aware:
* **Client‑side analysis is trusted.** Detection, liveness and the descriptor are computed in the browser. A technically skilled user could, in principle, call `face_clock` directly with a previously captured descriptor of themselves and fabricated liveness scores. This is self‑attendance fraud (punching without being present), not impersonation of someone else, and it is visible in the recognition log (identical descriptors, implausible timings). For high‑assurance sites use a **supervised kiosk** or a **server‑side provider** (below), and keep GPS/site flags on.
* 3D masks and deepfake video injection (virtual cameras) are not reliably detected by the browser models.
* Accuracy depends on lighting and camera quality. Thresholds are not universal; calibrate as above.
* Attendance must never depend on face alone: regularisation requests, HR manual attendance and biometric devices are all available.

## Offline punches

If the network is down, the punch (including the descriptor) is encrypted with a non‑extractable AES‑GCM key in IndexedDB and synced automatically when back online. **Matching still happens on the server at sync time.** The server accepts the device timestamp only within `offline_max_age_hours`, flags offline punches for review, and ignores duplicates.

## Privacy

* Explicit consent with versioned notice (`data_consents`); withdrawal deletes templates immediately.
* Retention: templates of exited employees are purged after `biometric_retention_days`; recognition logs after `recognition_log_retention_days` (`purge_sensitive_data()` weekly job).
* Access: only HR with `attendance.face_enrol` sees enrolment status and logs; nobody can read templates.

## Replacing the provider

1. Implement `FaceProvider` (`src/face/types.ts`): `load`, `detect` → `{ embedding, antispoof, liveness, yaw/pitch, ear, box }`, `similarity`.
2. Register it in `src/face/index.ts` and add it to the provider select (it appears automatically).
3. In `face_similarity(p_model, a, b)` add the model’s similarity formula (cosine is already the default for unknown models — suitable for ArcFace/AdaFace‑style normalised embeddings).
4. Re‑enrol employees (templates are model‑specific).

For server‑side verification (recommended for maximum assurance), have the provider upload a short liveness clip to an edge function that runs your recognition service and returns the descriptor/decision, then call the same `_face_evaluate` logic from the edge function with the service role. Note: popular open‑weight ArcFace models from InsightFace are licensed for non‑commercial research only; check licences before choosing.
