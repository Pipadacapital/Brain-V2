"""lifecycle — Phase-2 slice-8 (feat-lifecycle-timings-email) application use-cases.

READ/ANALYTICS ONLY. These use-cases REPORT on past lifecycle state, order timings,
and email/SMS performance. They NEVER add an outbound send (WhatsApp/SMS/email/call),
audience-to-channel dispatch, or any write to the lifecycle-service outbound path.
Crossing that boundary would re-trigger full DLT/NCPR/9am-9pm/consent compliance review
and is OUT OF Phase-2 scope (epic compliance flag, Shreya S4 confirmed).
"""
