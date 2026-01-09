# CLAUDE.md - Conversation Memory V2 Integration

> 이 파일을 프로젝트 루트에 배치하면 Claude Code가 자동으로 메모리 관리 규칙을 따릅니다.

## Memory Management Rules

This project uses **Conversation Memory V2** for intelligent context management.
The MCP server `conversation-memory` provides tools for managing long-term conversation history.

### Required Actions (MUST Follow)

#### 1. Before Each Response
```
Call `memory_should_compress` to check compression status.

If `shouldCompress` is true:
  1. Call `memory_get_context` to get compressed context
  2. Use the compressed context instead of full history
  3. Continue with your response
```

#### 2. After Each Response
```
Call `memory_auto_save` with:
  - role: "assistant"
  - content: your response content

This automatically:
  - Saves the message to persistent storage
  - Triggers background summarization
  - Returns compression status
```

#### 3. When User Sends a Message
```
Call `memory_auto_save` with:
  - role: "user"  
  - content: user's message content
```

### Search Past Conversations

When you need information from previous sessions:
```
Call `memory_search` with relevant keywords.

The system maintains full conversation history across sessions.
Use this when:
  - User asks "what did we discuss about X?"
  - You need context from earlier in the project
  - Looking for specific code or decisions
```

### Session Management

#### Starting a New Topic
```
Call `memory_initialize_session` with:
  - topic: "New feature: Authentication"

This creates a new conversation while preserving history.
```

#### Resuming Previous Session
```
Call `memory_initialize_session` without topic.

This loads the previous session's compressed context.
```

### Health Monitoring

Check session health periodically:
```
Call `memory_get_snapshot`

Returns:
  - health: "healthy" | "warning" | "critical"
  - totalTokens: current token count
  - compressionRatio: compression efficiency
```

### Emergency Compression

If context becomes too large:
```
Call `memory_force_compress`

This immediately compresses all history and returns the result.
```

---

## Configuration

The memory system uses these defaults:
- Compression threshold: 50,000 tokens
- Warning threshold: 30,000 tokens
- Chunk size: 500 tokens
- Merge size: 5 chunks

To adjust:
```
Call `memory_set_thresholds` with:
  - compressionThreshold: 50000
  - warningThreshold: 30000
```

---

## Why This Matters

Without memory management:
- Context window fills up (200K limit)
- Claude's auto-compression loses important details
- Project continuity breaks across sessions

With Conversation Memory V2:
- 90%+ compression while preserving key decisions
- Cross-session continuity
- Searchable conversation history
- Automatic background processing

---

## Quick Reference

| Action | Tool | When |
|--------|------|------|
| Check compression | `memory_should_compress` | Before every response |
| Save message | `memory_auto_save` | After every message |
| Get context | `memory_get_context` | When compression needed |
| Search history | `memory_search` | When looking for past info |
| Check health | `memory_get_snapshot` | Periodically |
| Force compress | `memory_force_compress` | Emergency only |
