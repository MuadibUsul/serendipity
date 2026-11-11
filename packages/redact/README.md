# @serendipity/redact

Defence in depth for everything a process writes down: log lines and audit metadata
([ADR-0006](../../docs/adr/0006-audit-tracing-redaction-and-alerts.md)). Code must not log personal
data in the first place; this removes what slips through anyway.

```ts
import { redactFields, redactText } from "@serendipity/redact";

redactFields({ email: "alice@example.com", detail: "call 13800138000" });
// { email: "[redacted]", detail: "call [redacted]" }
redactText("Key (email)=(alice@example.com) exists"); // "Key (email)=([redacted]) exists"
```

| Rule                    | What is replaced                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal-data keys      | The whole value of `email`, `phone`, `mobile`, `password`, `secret`, `token`, `apiKey`, `authorization`, `cookie`, `address`, `name`, `ip`, `userAgent`, … (any case or separator, and keys ending in them) |
| Addresses               | Anything shaped like `local@domain`                                                                                                                                                                         |
| Numbers                 | Nine or more digits in a row, or written in groups of 2–4 that add up to nine or more (phone, ID and card numbers); resident ID numbers; integers of 11+ digits                                             |
| Network                 | IPv4 addresses, IPv6 addresses written with four or more groups                                                                                                                                             |
| Credentials and secrets | `Bearer …` / `Basic …`, JSON web tokens, hex of 40+ characters, 32+ characters mixing upper, lower and digits                                                                                               |

Kept on purpose:

- dates and UUIDs;
- the ids this codebase generates (`trace_id`, `span_id`, `req_id`, `request_id`) and `host`;
- booleans and small numbers.

Errors are reduced to their type. Output is bounded: depth 8, 50 items per array and 1000
characters per string, and strings are redacted before they are cut. A key that is itself personal
data (a map keyed by e-mail address) is renamed. The input is never changed.

Known over-redaction: three short numbers written in a row (`12 345 6789`) cannot be told apart
from a phone number and are replaced.
