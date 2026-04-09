# Messaging Implementation Checklist

## Phase 1: Foundation — EditorInput + EditorPane + Sidebar

### 1.1 MessagingEditorInput (ciyexEditorInput.ts)
- [x] Add `MessagingEditorInput` class extending `EditorInput`
- [x] Fields: `channelId`, `channelName`, `channelType` (public/private/dm/group_dm)
- [x] Optional: `threadParentId` (for thread view in split editor)
- [x] `typeId` = `workbench.input.ciyexMessaging`
- [x] `resource` URI: `ciyex-messaging:///messaging/{channelId}`
- [x] `getName()` returns `#channelName` or user name for DMs
- [x] `getIcon()` returns `comment-discussion` for channels, `account` for DMs
- [x] `matches()` compares `channelId` + `threadParentId`

### 1.2 MessagingEditor (editors/messagingEditor.ts)
- [x] Create `MessagingEditor` extending `EditorPane`
- [x] ID = `ciyex.messagingEditor`
- [x] `createEditor()` — create root container
- [x] `setInput()` — load channel messages from API
- [x] **Header bar:**
  - [x] Channel name + type icon (# or avatar)
  - [x] Topic text (if channel has topic)
  - [x] Search button (🔍)
  - [x] Pin button (📌)
- [x] **Message list (scrollable div):**
  - [x] Date separators ("Today", "Yesterday", "Apr 7")
  - [x] Message bubbles with:
    - [x] Avatar (colored initials, hue from name hash)
    - [x] Sender name (bold) + timestamp
    - [x] Content text (with @mention highlighting)
    - [x] Attachment cards (file icon + name + size)
    - [x] Reaction bar (emoji + count, clickable to toggle)
    - [x] Thread preview ("💬 N replies" — click opens thread)
  - [x] Hover actions toolbar: React (😀), Reply (💬), Pin (📌), Edit (✏️), Delete (🗑️)
  - [ ] Load more on scroll to top (pagination)
- [x] **Compose bar (fixed bottom):**
  - [x] Multi-line textarea (Enter=send, Shift+Enter=newline)
  - [x] Attach button (📎) → file picker
  - [ ] @mention autocomplete popup
  - [x] Send button
- [x] **Polling:** Refresh messages every 5s for active channel
- [x] `layout()` — resize message list + compose bar

### 1.3 ChannelListPane (messaging/channelListPane.ts)
- [x] Create `ChannelListPane` extending `ViewPane`
- [x] ID = `ciyex.messaging.channels`
- [x] **Toolbar:**
  - [x] Search input (filter channels by name)
  - [x] + New Channel / DM button with picker
- [x] **Sections (grouped):**
  - [x] CHANNELS — public/private channels with # prefix
  - [x] DIRECT MESSAGES — DMs with avatar + preview
- [x] **Click action:** Opens channel as editor tab
- [ ] **Right-click context menu:** Mute, Mark read, Leave, Archive
- [x] **Load channels** from `GET /api/channels`
- [x] **Poll unread counts** every 30s

### 1.4 View Container + Editor Registration
- [x] `ciyex.messaging` view container in activity bar (💬 icon)
- [x] `ciyex.messaging.channels` view registered
- [x] `MessagingEditor` registered as editor pane descriptor
- [x] `MessagingEditorInput` in editor contribution

### 1.5 Commands
- [x] `ciyex.openMessaging` — open first channel or fallback
- [x] `ciyex.messaging.openThread` — open thread as editor tab

### 1.6 Sidebar ↔ Editor Pairing
- [x] `workbench.input.ciyexMessaging` → `ciyex.messaging` in editorToSidebar
- [x] `ciyex.messaging` → `ciyex.messaging.channels` in containerToView

---

## Phase 2: Rich Features

### 2.1 Emoji Reactions
- [x] Quick reaction bar on hover (👍 ❤️ 😂)
- [x] Click emoji → `POST /api/messages/{id}/reactions` (toggle)
- [x] Show reaction badges below message with count
- [x] Highlight reactions that include current user

### 2.2 Message Threading
- [x] "💬 N replies" link on messages with replies
- [x] Click → opens thread via `ciyex.messaging.openThread` command
- [x] Thread editor shows parent message + all replies
- [x] Thread compose bar sends with `parentId`

### 2.3 File Attachments
- [x] 📎 button opens file picker dialog
- [x] Upload via `POST /api/messages/{id}/attachments` (multipart)
- [x] Display attachment cards: icon + filename + size
- [ ] Click attachment → download or preview
- [ ] Image attachments: show inline thumbnail

### 2.4 @Mention Rendering
- [x] @mentions highlighted in blue in message content
- [ ] @mention autocomplete popup on `@` keystroke

### 2.5 Message Search
- [x] 🔍 button in channel header (placeholder)
- [ ] Search input + results filtered view

### 2.6 Pin Messages
- [x] 📌 button in hover actions → toggle pin
- [x] 📌 button in header (placeholder)
- [ ] Pinned messages panel

### 2.7 Message Edit/Delete
- [x] Edit button (✏️) in hover actions for own messages
- [x] Delete button (🗑️) in hover actions for own messages
- [x] Show "(edited)" indicator on edited messages
- [x] Show "[deleted]" placeholder for deleted messages
- [x] Up arrow in empty compose → edit last own message

### 2.8 Markdown Rendering
- [x] **bold**, _italic_, `code` rendering
- [x] @mention highlighting
- [x] HTML escaping for security

---

## Phase 3: Polish + Integrations

### 3.1 Notifications
- [x] Status bar unread count: `💬 N` (polls every 30s)
- [x] Click status bar → opens messaging
- [ ] VS Code notification toast for new messages
- [ ] Notification sound toggle (user setting)

### 3.2 Channel Management
- [x] Create channel dialog (+ button → name prompt)
- [x] Create DM dialog (+ button → email prompt)
- [ ] Edit channel: name, topic (admin only)
- [ ] Archive channel
- [ ] Leave channel
- [ ] Invite/remove members

### 3.3 Keyboard Shortcuts
- [ ] `Cmd+Shift+M` — toggle messaging sidebar
- [ ] `Cmd+K` — quick channel switcher (QuickPick)

### 3.4 Integration with other editors
- [ ] Patient Chart → "💬 Message" button
- [ ] Encounter → "Share in channel"
- [ ] Calendar → "Message patient/provider"

### 3.5 Mark Read/Unread
- [x] Auto mark-read when channel editor opens (`POST /api/channels/{id}/read`)
- [ ] Right-click → "Mark as unread"
- [ ] Unread channels shown in bold in sidebar

---

## Phase 4: DROPPED — Not Needed

WebSocket/real-time not needed for clinical secure messaging.
Workflow: Provider sends → Patient gets email notification → Logs into portal → Reads/replies.
30s polling is sufficient. Email/push notifications handle delivery.
