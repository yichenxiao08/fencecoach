# Interpreting side-view pose measurements

These are development notes about measurement interpretation, not a certified technique rubric.

Knee angle is the image-plane angle at the hip–knee–ankle landmarks. Camera perspective, occlusion,
clothing and detection errors affect it. Compare the same athlete, camera, drill and phase. There is
no universal target knee angle in this library. A lower angle means more bend in the measured image;
it does not independently prove a better lunge or a safer position.

Torso tilt measures the shoulder midpoint to hip midpoint against image vertical. It does not measure
spinal curvature or establish whether someone's back is straight. A tilted camera also changes this
measurement. Review the corresponding frame with a fencing coach.

Arm extension is shoulder-to-wrist distance divided by upper-arm plus forearm length in the image.
A ratio close to one suggests a straighter tracked arm in that image. The side must match the weapon
arm. The onset marker is a stance-expansion proposal; it is not proof of attack initiation, right of
way, weapon position or contact. Wrist height is relative to the tracked hip in torso-length units.
These points cannot establish a correct weapon guard position without weapon tracking and context.

Recovery hip speed is the median horizontal image-plane hip displacement per second, normalized by
torso length at the start of the reviewed recovery interval. It is not metres per second. Recovery
time ends at the initial stance band; neither speed nor time alone establishes balance or quality.

For a repeatable measurement drill, record five deliberate lunges and recoveries with a fixed side
camera and the whole body visible. Review movement onset, peak and return. Choose one correction
with a fencing coach, then repeat the same setup. The success criterion is five reviewable reps and
one recorded practice focus, rather than meeting an invented angle threshold.
