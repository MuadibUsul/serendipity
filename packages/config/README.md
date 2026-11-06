# @serendipity/config

Runtime configuration for every Serendipity process: parsed from environment variables, validated
as a whole, and refused at start-up when it would mix environments
([ADR-0004](../../docs/adr/0004-environments-and-configuration.md)).

```ts
import { requireConfig } from "@serendipity/config";

const config = requireConfig(process.env); // throws, listing every problem, if anything is wrong
config.env; // "dev" | "test" | "staging" | "prod"
config.database.url;
config.features.paidBooking; // false unless FEATURE_PAID_BOOKING=true
```

| Variable                                                                                          | Required      | Rule                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP_ENV`                                                                                         | yes           | `dev`, `test`, `staging` or `prod`                                                                                                                                                                                                               |
| `DATABASE_URL`                                                                                    | yes           | `postgresql://…/serendipity_<env>` (tests may add a suffix); no host named for another environment. Staging and prod also need: a non-local host, `sslmode=require`, `verify-ca` or `verify-full`, not the dev password, nothing named `fixture` |
| `SECRET_STORE`                                                                                    | staging, prod | A managed store named for its own environment and no other, e.g. `aws-sm://ap-east-1/serendipity-prod`. Dev and test default to `env://local` and may not name a deployed environment's store                                                    |
| `FEATURE_VISUAL_MATCHING`, `FEATURE_A2A_NEGOTIATION`, `FEATURE_PAID_BOOKING`, `FEATURE_LIVE_CHAT` | no            | `true` or `false` (default `false`)                                                                                                                                                                                                              |
| `LOG_LEVEL`                                                                                       | no            | `debug`, `info` (default), `warn` or `error`; prod refuses `debug`                                                                                                                                                                               |

The environment definitions in `infra/environments/` are tested against these rules. Each must be a
configuration the loader accepts, and each environment's database and secret store must be
refused to every other environment.
