---
name: recap
description: "Recap, summarize, or audit a Claude Code project. Use this skill whenever the user wants to understand the current state of a Claude Code project — including its architecture, progress, open issues, key decisions, and next steps. Triggers include any mention of 'recap my project', 'summarize the project', 'where did we leave off', 'project status', 'what's the state of the codebase', 'sitrep', 'project overview', or any request to review, audit, or get up to speed on a Claude Code project. Also trigger when the user uploads a project archive (.zip/.tar.gz) and asks for a summary, or when they ask you to look at a GitHub repo structure they've shared. Even casual phrasing like 'what have we built so far' or 'remind me what this project does' should trigger this skill."
---

# Claude Code Project Recap

Generate a structured, actionable summary of a Claude Code project by systematically reading the project's key artifacts.

## When to use this skill

- The user asks for a recap, summary, status update, or audit of a Claude Code project
- The user wants to get back up to speed after time away from a project
- The user uploads a project archive and asks what's in it
- The user references a project they've been building with Claude Code and wants an overview
- A new team member needs onboarding context about an existing project

## Step 1: Locate the project artifacts

Determine where the project lives. There are three common scenarios:

**A) Uploaded archive** — the user uploaded a .zip or .tar.gz to `/mnt/user-data/uploads/`. List its contents first, then extract to `/home/claude/project-recap/`:
```bash
# For zip
unzip -l /mnt/user-data/uploads/project.zip
mkdir -p /home/claude/project-recap && cd /home/claude/project-recap
unzip /mnt/user-data/uploads/project.zip -d .

# For tar
tar -tf /mnt/user-data/uploads/project.tar.gz
mkdir -p /home/claude/project-recap && cd /home/claude/project-recap
tar -xzf /mnt/user-data/uploads/project.tar.gz -C .
```

**B) Uploaded individual files** — the user shared specific files (CLAUDE.md, package.json, etc.). Work with what's available in `/mnt/user-data/uploads/`.

**C) Conversation context only** — no files uploaded, but the user references a project you've discussed before. Use the `conversation_search` tool to find prior conversations about the project. Search for the project name, key technologies, and terms like "CLAUDE.md", "architecture", "PRD", etc.

## Step 2: Read the project systematically

Read artifacts in this priority order. Not every project will have all of these — read what exists and skip what doesn't.

### Tier 1 — Identity & Intent (read these first, they frame everything)

| File | What it tells you | How to read |
|------|-------------------|-------------|
| `CLAUDE.md` | Agent constitution, hard rules, project philosophy, coding conventions | `cat` the whole file — it's always small enough |
| `README.md` | Project purpose, setup, usage | `cat` or `head -200` if very long |
| `package.json` / `pyproject.toml` / `requirements.txt` / `Cargo.toml` | Tech stack, dependencies, scripts | `cat` the whole file |

### Tier 2 — Structure & Architecture (map the codebase)

| Artifact | What it tells you | How to read |
|----------|-------------------|-------------|
| Directory tree | Overall project shape, module organization | `find . -type f \| grep -v node_modules \| grep -v .git \| grep -v __pycache__ \| head -80` or use `view` on root |
| `src/` or `lib/` entry points | Core architecture, main modules | Read the top-level index/main files |
| Config files (`.env.example`, `tsconfig.json`, `docker-compose.yml`) | Environment, build config, infrastructure | Quick scan |
| `docs/` or `references/` | Design docs, PRDs, API specs | `ls` first, then read selectively |

### Tier 3 — Progress & History (understand what's been done)

| Artifact | What it tells you | How to read |
|----------|-------------------|-------------|
| `.git` history | Recent work, commit patterns, active branches | `git log --oneline -20` and `git branch -a` |
| GitHub Issues / `.github/` | Issue templates, CI/CD, contribution guidelines | `ls .github/` and scan key files |
| `CHANGELOG.md` or release notes | Version history, milestones | `head -50` |
| TODO comments in code | Incomplete work, known gaps | `grep -rn "TODO\|FIXME\|HACK\|XXX" --include="*.ts" --include="*.py" --include="*.js" --include="*.md" \| head -30` |

### Tier 4 — Testing & Quality

| Artifact | What it tells you | How to read |
|----------|-------------------|-------------|
| Test files (`__tests__/`, `tests/`, `*.test.*`) | Test coverage, what's validated | `find . -path "*/test*" -name "*.ts" -o -name "*.py" \| head -20` |
| Linting / formatting config (`.eslintrc`, `.prettierrc`, `ruff.toml`) | Code quality standards | Quick scan |

## Step 3: Produce the recap

After reading the artifacts, produce a recap with the following structure. Adapt the depth of each section based on what you actually found — don't fabricate sections for which you have no evidence.

### Recap Structure

**Project Identity**
- Name, one-line purpose, and target user/audience
- Core tech stack (language, framework, key libraries)

**Architecture Overview**
- High-level architecture (layers, modules, data flow)
- Key design patterns or architectural decisions
- External integrations (APIs, databases, MCP connections, etc.)

**Current State**
- What's been built and is working
- What's in progress or partially implemented
- What's planned but not yet started

**Key Decisions & Conventions**
- Important rules from CLAUDE.md or coding conventions
- Architectural trade-offs that were made and why (if documented)

**Open Items & Risks**
- TODOs and FIXMEs found in the code
- Known gaps or missing pieces
- Potential risks or blockers

**Recommended Next Steps**
- Based on the project's state, suggest 3-5 concrete next actions
- Prioritize by impact and dependency order

## Guidelines

- Be concrete and specific — reference actual file names, module names, and function names you found
- Distinguish between what you observed in the code vs. what you inferred
- If the project has a delivery plan or sprint structure, map current progress against it
- If you found a CLAUDE.md with hard rules, highlight the most important ones — these are the project's "constitution" and shouldn't be violated
- When context comes from past conversations rather than files, note that explicitly so the user knows the freshness of the information
- Keep the recap scannable — use prose paragraphs, not excessive bullet lists
- If the project is large, offer to deep-dive into specific areas after the overview
