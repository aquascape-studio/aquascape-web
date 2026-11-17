# aquascape-web

**Owner**: app-agent  
**Stack**: Next.js 15 (App Router, RSC) + TypeScript + Tailwind  
**Deploy**: ECR → ECS Fargate, port 3000, behind ALB + CloudFront at efferves.live

## Layout

```
aquascape-web/
├── app/
│   ├── page.tsx             # marketing + live 3D demo
│   ├── studio/              # authenticated editor
│   ├── scapes/[id]/         # public scape viewer
│   ├── plants/              # species library (English search)
│   ├── learn/               # MDX articles
│   └── api/                 # tRPC + next-auth
├── components/
├── lib/
├── buf.gen.yaml             # Connect-ES codegen from proto submodule
├── Dockerfile
└── package.json
```

## Path note

Agent definitions reference `apps/web/` — the actual root is `aquascape-web/`.

## Key commands

```bash
pnpm build
pnpm dev
buf generate                 # after proto submodule bump
```

## Contracts

- gRPC client via Connect-ES → aquascape-api (port 50051 via ALB)
- Reads `@aquascape/ui` and `@aquascape/render` as npm deps
- Infra config from `aquascape-infra/outputs.json` at build time — never call AWS SDK from browser
