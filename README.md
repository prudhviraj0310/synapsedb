<p align="center">
  <br />
  <img src="https://img.shields.io/badge/SYNAPSE-DB-000000?style=for-the-badge&labelColor=0A0A0A&color=00FFB3&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0yMiAxMmgtNGwtMyA5TDkgM2wtMyA5SDIiLz48L3N2Zz4=" alt="SynapseDB" />
  <br /><br />
  <strong>The Autonomous Data Operating System</strong>
  <br />
  <em>One engine. Every database. Zero decisions.</em>
  <br /><br />
  <a href="https://www.npmjs.com/package/@synapsedb/cli"><img src="https://img.shields.io/npm/v/@synapsedb/cli.svg?style=flat-square&color=00FFB3" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="node version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square&logo=typescript&logoColor=white" alt="typescript" />
  <img src="https://img.shields.io/badge/tests-passing-brightgreen?style=flat-square" alt="tests" />
  <img src="https://img.shields.io/badge/PRs-welcome-orange?style=flat-square" alt="prs" />
  <br /><br />
</p>

---

<br />

> **SynapseDB doesn't replace your database. It replaces the decisions you make about it.**
>
> You declare what your data *means*. Synapse decides where it *lives*, how it *moves*, and when it *heals*.

<br />

## ⚡ Try It in 10 Seconds

```bash
npx synapsedb dev
```

That's it. No config files. No Docker. No env vars.

Your terminal transforms into a living, breathing control room — real-time telemetry, autonomous routing decisions, and interactive mode-switching — all rendered at 60FPS natively in your console.

<br />

---

<br />

## 🧠 What is SynapseDB?

SynapseDB is a **7-Layer Data Orchestration Engine** that sits between your application and your databases.

You write one query. Synapse compiles it into an Abstract Syntax Tree, analyzes the field-level intent annotations, and autonomously routes each field to the optimal storage backend — **PostgreSQL** for ACID transactions, **Redis** for sub-millisecond edge caching, **MongoDB** for flexible documents, and **Vector stores** for AI embeddings.

This is not an ORM. This is not a query builder. This is a **Data Operating System**.

```typescript
import { SynapseEngine } from '@synapsedb/core';

const db = new SynapseEngine({
  plugins: {
    postgres: { type: 'sql',    package: '@synapsedb/plugin-postgres', config: { connectionUri: process.env.PG_URI } },
    redis:    { type: 'cache',  package: '@synapsedb/plugin-redis',    config: { connectionUri: process.env.REDIS_URI } },
    mongo:    { type: 'nosql',  package: '@synapsedb/plugin-mongodb',  config: { connectionUri: process.env.MONGO_URI } },
    vectors:  { type: 'vector', package: '@synapsedb/plugin-vector',   config: { connectionUri: process.env.VECTOR_URI } },
  },
});

await db.initialize();

// Define intent — not tables
db.defineCollection({
  name: 'users',
  fields: {
    id:        { type: 'uuid', primary: true, auto: true },
    email:     { type: 'string', unique: true, transactional: true },    // → PostgreSQL (B-Tree)
    profile:   { type: 'json', flexible: true, nested: true },           // → MongoDB (Document)
    session:   { type: 'string', cached: true, ttl: 3600 },             // → Redis (Edge Cache)
    embedding: { type: 'vector', dimensions: 1536 },                     // → Vector DB (ANN)
  },
});

// One query — four databases — zero decisions
const user = await db.findOne('users', { email: 'alex@synapse.io' });
```

Synapse's **Kinetic Router** analyzed the field annotations at startup. It knows `email` is transactional (SQL), `profile` is flexible (NoSQL), `session` is cached (Redis), and `embedding` is a vector (ANN index). When you query, the engine compiles a parallel execution plan, fetches from all four backends simultaneously, joins the results by primary key, and returns a single unified document.

You wrote one line. Four databases responded. You didn't choose any of them.

<br />

---

<br />

## 🏗️ The 7-Layer Architecture

SynapseDB is not a monolith. It is a vertically integrated stack of specialized layers, each independently testable and replaceable.

```
┌─────────────────────────────────────────────────────────────┐
│  L1  CLIENT APPS           Next.js · Express · Fastify      │
├─────────────────────────────────────────────────────────────┤
│  L2  UNIFIED API           db.find() · db.insert() · db.sync()
├─────────────────────────────────────────────────────────────┤
│  L3  QUERY ENGINE          AST Compiler → Execution Planner │
├─────────────────────────────────────────────────────────────┤
│  L4  CORE ENGINE           Kinetic Router · DB Detector     │
│                            Feature Bridge · CDC Sync        │
├─────────────────────────────────────────────────────────────┤
│  L5  MIDDLEWARE             Query Cache · Schema Migrator   │
│                            Observability · Write Buffer     │
├─────────────────────────────────────────────────────────────┤
│  L6  DRIVER ADAPTERS        Plugin Registry · Health Monitor│
├─────────────────────────────────────────────────────────────┤
│  L7  CONNECTED DBs          PostgreSQL · MongoDB · Redis    │
│                             DuckDB · Pinecone · Qdrant     │
└─────────────────────────────────────────────────────────────┘
```

**Every layer has a job:**

| Layer | Responsibility | Key Innovation |
|:------|:---------------|:---------------|
| **L1** | Framework adapters | Native middleware for Next.js, Express, Fastify |
| **L2** | Developer-facing API | One interface across all backends |
| **L3** | Query compilation | Unified AST → native SQL / MQL / Vector queries |
| **L4** | Orchestration brain | Field-level routing based on intent annotations |
| **L5** | Operational safety | Transparent caching, migrations, metrics |
| **L6** | Storage abstraction | Hot-swappable plugin system |
| **L7** | Physical databases | Production-grade adapters with connection pools |

<br />

---

<br />

## 🔬 Core Engine Deep Dive

### The Kinetic Router (L3 → L4)

Traditional ORMs force a 1:1 mapping between your model and a single database. SynapseDB's **Kinetic Router** breaks this constraint.

When you call `db.defineCollection()`, the router inspects every field annotation:

- `transactional: true` → routes to SQL (ACID guarantees)
- `flexible: true` → routes to NoSQL (schema-less storage)
- `cached: true, ttl: N` → routes to Cache (sub-ms reads)
- `type: 'vector'` → routes to Vector DB (ANN similarity search)

It generates a **Collection Routing Map** — a deterministic plan describing which plugin owns which field. At query time, the engine compiles a parallel **Execution DAG** (Directed Acyclic Graph) that fetches data from multiple backends concurrently and joins results by primary key.

### The Unified Query Compiler (L3)

Every developer query is compiled into a **QueryAST** — an intermediate representation that is database-agnostic:

```typescript
interface QueryAST {
  type: 'FIND' | 'FIND_ONE' | 'INSERT' | 'UPDATE' | 'DELETE' | 'SEARCH' | 'COUNT';
  collection: string;
  filters?: FilterGroup;
  projection?: string[];
  sort?: SortSpec[];
  limit?: number;
  offset?: number;
  vectorQuery?: { field: string; vector: number[]; topK: number };
}
```

The compiler then emits native queries for each backend:
- **SQL Emitter** → `SELECT id, email FROM users WHERE email = $1`
- **Document Emitter** → `db.users.findOne({ email: 'alex@synapse.io' })`
- **Vector Emitter** → Cosine similarity search against embedding index

### CDC Sync Engine (L4)

SynapseDB maintains **eventual consistency** across backends using Change Data Capture:

1. A write to PostgreSQL emits a `ChangeEvent`
2. The `Propagator` captures it and fans out to Redis (cache invalidation) and MongoDB (document sync)
3. Conflict resolution uses Last-Write-Wins with vector clocks
4. Failed propagations land in a **Dead Letter Queue** for manual replay

### Resilience Layer (L4)

Production systems fail. SynapseDB survives:

- **Circuit Breakers** — If PostgreSQL goes down, the engine automatically falls back to MongoDB for reads
- **Retry Manager** — Exponential backoff with jitter for transient failures
- **Idempotency Store** — Duplicate writes are detected and suppressed
- **Write Buffer** — Batches small writes into efficient bulk operations

### Intelligence Layer (v0.3)

SynapseDB doesn't just route data — it learns from it:

- **Workload Analyzer** — Monitors query patterns and promotes hot data to cache automatically
- **Cold Storage Archiver** — Detects untouched rows and archives them to S3/GCS
- **Natural Language Queries** — Convert English to QueryAST: `"find users who signed up last week"` → `{ type: 'FIND', filters: ... }`

<br />

---

<br />

## 🎮 The Terminal OS

SynapseDB ships with a cinematic terminal interface built on `blessed-contrib`. These aren't dashboards — they are **operational control surfaces**.

### 13 Autonomous Commands

<table>
<tr>
<td width="50%">

#### 🖥️ Monitoring & Telemetry
| Command | What It Does |
|:--------|:-------------|
| `synapse dev` | Interactive 60FPS telemetry dashboard with mode switching |
| `synapse pulse` | Network topology sonar — pings every microservice |
| `synapse map` | ASCII world globe with live packet routing animation |
| `synapse trace` | Visual query execution path through the routing layers |

</td>
<td width="50%">

#### ⚔️ Chaos & Security
| Command | What It Does |
|:--------|:-------------|
| `synapse play ddos` | Simulate a 14K req/sec L7 DDoS and watch auto-mitigation |
| `synapse guard` | Real-time SQL injection firewall with quarantine zone |
| `synapse lock` | Matrix-style PII sweep encrypting data to SHA-256 |
| `synapse nuke` | Emergency OOM purge — visually melts cache to save the server |

</td>
</tr>
<tr>
<td>

#### 🔧 Recovery & Operations
| Command | What It Does |
|:--------|:-------------|
| `synapse heal` | Autonomous schema surgery — detects missing columns, injects SQL |
| `synapse freeze` | Zero-ETL data archival with live AWS cost savings counter |
| `synapse replay --incident ddos-114` | Forensic incident reconstruction |

</td>
<td>

#### 🧠 Intelligence
| Command | What It Does |
|:--------|:-------------|
| `synapse chat` | Split-pane AI copilot analyzing live telemetry in natural language |
| `synapse ghost` | Shadow traffic replicator — mirrors prod to staging |
| `synapse warp` | Billion-row migration engine with speed benchmarks |

</td>
</tr>
</table>

### Interactive Modes (`synapse dev`)

While the dashboard is running, press:

| Key | Mode | Behavior |
|:---:|:-----|:---------|
| `A` | **Aggressive** | Maximum throughput, minimal cache TTL |
| `S` | **Safe** | Conservative routing, extended health checks |
| `C` | **Cost-Saver** | Compress connections, extend cold archival |
| `B` | **Balanced** | Default production profile |
| `Q` | **Exit** | Clean teardown, no zombie processes |

<br />

---

<br />

## 📦 Monorepo Structure

```
synapsedb/
├── packages/
│   ├── core/                    # The 7-layer engine (50K+ lines)
│   │   ├── compiler/            #   L3 — AST Compiler + SQL/MQL/Vector emitters
│   │   ├── router/              #   L4 — Kinetic Router + Execution Planner
│   │   ├── joiner/              #   L4 — Cross-backend result merging
│   │   ├── sync/                #   L4 — CDC, Event Bus, CRDT conflict resolution
│   │   ├── detector/            #   L4 — Auto-detect databases from connection URIs
│   │   ├── bridge/              #   L4 — Feature capability negotiation
│   │   ├── middleware/          #   L5 — Cache, Migrations, Observability, Write Buffer
│   │   ├── plugin/              #   L6 — Plugin Registry + Health Monitor
│   │   ├── intelligence/        #   Workload Analyzer, NLQ Engine
│   │   ├── analytics/           #   Aggregation Engine, CDC Analytics Bridge
│   │   ├── storage/             #   Cold Storage Archiver
│   │   ├── resilience/          #   Circuit Breaker, Retry, DLQ, Idempotency
│   │   └── edge/                #   Edge KV Store, Edge Router
│   │
│   ├── cli/                     # Terminal OS (13 cinematic commands)
│   │   ├── bin/synapsedb.ts     #   Commander.js entry point
│   │   ├── commands/            #   dev, play, map, guard, freeze, heal, chat...
│   │   └── test/                #   Unit + E2E test suites (Vitest)
│   │
│   ├── sdk/                     # Client SDK for browser/Node consumers
│   ├── express/                 # Express.js middleware adapter
│   ├── fastify/                 # Fastify plugin adapter
│   ├── nextjs/                  # Next.js API route adapter
│   │
│   └── plugins/                 # Storage backend adapters
│       ├── plugin-postgres/     #   PostgreSQL (pg, connection pooling)
│       ├── plugin-mongodb/      #   MongoDB (native driver)
│       ├── plugin-redis/        #   Redis (ioredis, TTL management)
│       └── plugin-vector/       #   Vector DB (Pinecone/Qdrant compatible)
│
├── apps/
│   └── demo/                    # Full integration demo application
│
├── docs/                        # Architecture docs, API reference
├── docker-compose.yml           # Local dev environment (PG + Redis + Mongo)
└── tsconfig.base.json           # Shared TypeScript strict config
```

<br />

---

<br />

## 🔧 Installation

### As a Library (Embed in your app)

```bash
npm install @synapsedb/core @synapsedb/plugin-postgres @synapsedb/plugin-redis
```

### As a CLI Tool (Terminal OS)

```bash
npm install -g @synapsedb/cli
synapsedb dev
```

### As a Server (Standalone data gateway)

```bash
npx synapsedb init          # Interactive project setup
docker-compose up -d        # Start PostgreSQL + Redis + MongoDB
npm start                   # Launch the REST API server
```

<br />

---

<br />

## 🧪 Testing

SynapseDB uses a tiered testing strategy designed for CI/CD environments where terminal screens don't exist.

```bash
# Run all workspace tests
npm test

# Run CLI-specific tests (Unit + E2E binary execution)
npm test -w packages/cli

# Run core engine integration tests
npm run test:integration
```

**Testing Architecture:**

| Tier | What It Tests | How |
|:-----|:-------------|:----|
| **Unit** | All 13 command handlers export valid functions | Direct import assertion |
| **E2E** | Compiled binary routes all commands correctly | `child_process.spawnSync()` against `dist/` |
| **Integration** | Core engine query routing across plugins | Live database connections |

<br />

---

<br />

## 🗺️ Roadmap

- [x] **v0.1** — Core engine, plugin system, query compiler
- [x] **v0.2** — Terminal OS (13 commands), CDC sync, middleware layer
- [ ] **v0.3** — Production hardening (connection pool tuning, query plan caching)
- [ ] **v0.4** — Real LLM integration for `synapse chat` (Ollama / OpenAI)
- [ ] **v0.5** — Distributed mode (multi-node Synapse clusters)
- [ ] **v1.0** — Managed cloud service

<br />

---

<br />

## 🤝 Contributing

We welcome contributions across every layer of the stack.

```bash
git clone https://github.com/prudhviraj0310/synapsedb.git
cd synapsedb
npm install
npm run build
npm test
```

**Quick contribution paths:**
- **New storage plugin** — Implement the `StoragePlugin` interface in `packages/plugins/`
- **New CLI command** — Add a handler in `packages/cli/src/commands/` and register in `bin/synapsedb.ts`
- **New framework adapter** — Follow the pattern in `packages/express/`
- **Bug fixes** — Run `synapse dev` for 60 seconds and report anything weird

<br />

---

<br />

## 📄 License

MIT © [SynapseDB Contributors](https://github.com/prudhviraj0310/synapsedb)

<br />

---

<p align="center">
  <br />
  <strong>Stop choosing databases. Start describing data.</strong>
  <br /><br />
  <code>npx synapsedb dev</code>
  <br /><br />
  <sub>Built with obsessive attention to detail by engineers who believe infrastructure should feel alive.</sub>
  <br /><br />
</p>