# Held-out diagrams

Real diagrams from public sources (C4 samples, documentation, reference architectures, homelab networks), written in Trace **as a user would write them first: no layout
help** (no rows, columns, align, span or side zones). They are never used to tune the layout rules: a rule is
generic when it improves the showcase cases without making these worse (`npm run metrics`).

Every `<name>.trace` has a `<name>.mmd` next to it, its Mermaid version: the original for diagrams that came
from Mermaid (converted with `tools/mermaid-to-trace.js`, untouched since), a flowchart written from the same
nodes and links for the C4 ones. `npm run build:compare` draws both side by side in `dist/compare.html`.

`full/<name>.trace` is the same diagram written the way a skilled user would, with every feature that helps (icons,
rows and columns, span, mark, join...): same nodes, links and labels. The comparison page shows it between the plain
version and Mermaid. It is never measured (`npm run metrics` reads only this folder's top level) and may be
reworked freely; the plain version may not.

Some are written for Trace instead, modelled on common real-world setups (the owner asked for realistic
infrastructure diagrams rather than resource maps found online). They follow the same rule, made checkable: each
is written as an engineer would first sketch it, checked only for errors, and committed before it is drawn even
once; from then on it is never changed to suit the engine (git history shows the first draft). Their Mermaid
version is generated from the same model with `tools/trace-to-mermaid.js`.

When adding one: take a real diagram from a public source with a permissive licence, keep its nodes, links and
labels, note the source and licence on the first line, and do not change it afterwards to suit the engine.

| File | Source | Licence |
|---|---|---|
| bigbank-context, bigbank-container, bigbank-components, bigbank-deployment, message-bus, techtribes, enterprise-context | C4-PlantUML samples (github.com/plantuml-stdlib/C4-PlantUML, `samples/`) | MIT |
| online-boutique | Google Cloud Online Boutique architecture (github.com/GoogleCloudPlatform/microservices-demo) | Apache 2.0 |
| mermaid-groups, mermaid-fan-in | Mermaid documentation, syntax/architecture.md (github.com/mermaid-js/mermaid) | MIT |
| k8s-ingress, k8s-ingress-fanout | Kubernetes documentation, concepts/services-networking/ingress.md (github.com/kubernetes/website) | CC BY 4.0 |
| gitlab-simple, gitlab-http-fetch, gitlab-ssh-fetch | GitLab documentation, doc/development/architecture.md (gitlab.com/gitlab-org/gitlab) | CC BY-SA 4.0 |
| otel-services, otel-telemetry | OpenTelemetry demo documentation, docs/demo/architecture.md (github.com/open-telemetry/opentelemetry.io) | CC BY 4.0 |
| eshop | .NET eShop reference application (github.com/dotnet/eShop, README, `img/eshop_architecture.png`) | MIT |
| eshop-containers | eShopOnContainers (github.com/dotnet-architecture/eShopOnContainers, README, `img/eShopOnContainers-architecture.png`); two arrows into Identity that come from nowhere left out | MIT |
| unifi-home-vlans | romvek/home-network-diagram (github.com/romvek/home-network-diagram, `diagrams/network.mmd`); converted, false nodes from links to subgraphs removed, emoji as icons | MIT (stated in its README; the repository has no LICENSE file) |
| proxmox-homelab-vlans | idrisschen/homelab (github.com/idrisschen/homelab, README, first Mermaid diagram); converted, same hand edits | MIT |
| k8s-platform, office-network, event-driven-orders, security-operations, file-backup, multi-region-saas | Written for Trace, modelled on common production setups (see each file's first line); frozen at the first draft | this repository's licence |

Left out: the full GitLab component diagram from the same page (about 80 links). It draws, but takes over four
minutes to lay out, too slow for the metrics run; see the roadmap.
