# EHR Messaging — Slack-Style Design for Ciyex Workspace

> **Date:** 2026-04-09
> **Status:** DRAFT

---

## 1. Executive Summary

Build a Slack-style messaging system natively in Ciyex Workspace using an **EditorPane** for the conversation view (same pattern as Calendar, Patient Chart, Encounter Form) and a **sidebar ViewPane** for the channel/DM list. Clicking a channel opens it as an editor tab — multiple conversations can be open as tabs, split side-by-side with Calendar or Chart. The current EHR UI already has a full messaging backend with channels, threads, reactions, pins, mentions, and attachments. This design ports that UI into native VS Code EditorPane components.

---

## 2. Current State (ciyex-ehr-ui)

The messaging system is **fully built** in the React EHR UI:

| Feature | Status | Backend Endpoint |
|---------|--------|-----------------|
| Channels (public/private) | Done | `POST /api/channels` |
| Direct Messages (1:1, group) | Done | `POST /api/channels/dm` |
| Message threading | Done | `GET /api/messages/{id}/thread` |
| Emoji reactions | Done | `POST /api/messages/{id}/reactions` |
| Pin messages | Done | `POST /api/messages/{id}/pin` |
| @mentions | Done | In message content + mentions JSONB |
| File attachments | Done | `POST /api/messages/{id}/attachments` |
| Message search | Done | `GET /api/messages/search?q=` |
| Typing indicators | Done (polling) | No WebSocket |
| Read/unread tracking | Done | `POST /api/channels/{id}/read` |
| Message edit/delete | Done | `PUT/DELETE /api/messages/{id}` |

**Backend:** `ciyex/src/main/java/org/ciyex/ehr/messaging/MessagingController.java`
**DB Tables:** `channel`, `message`, `message_reaction`, `message_attachment`, `channel_member`

---

## 3. Why NOT the VS Code Chat Panel

The VS Code Chat panel (`workbench.panel.chat`) was evaluated and **rejected** for EHR messaging:

| Aspect | VS Code Chat | EHR Needs |
|--------|-------------|-----------|
| Design pattern | AI agent ↔ User | User ↔ User |
| Message source | LLM response stream | REST API / WebSocket |
| Multi-conversation | Single session | Multiple channels + DMs |
| Participants | AI agents | Staff + patients |
| Reactions/threads | Not supported | Required |
| Presence/typing | Not supported | Required |
| Read receipts | Not supported | Required |
| File attachments | Limited (context) | Full upload/download |

The Chat panel is deeply coupled to the Language Model service and agent system. Repurposing it would require forking ~500KB of code with ongoing merge conflicts.

---

## 4. Design: EditorPane-Based Messaging

### 4.1 Why EditorPane (Not AuxiliaryBar)

| Aspect | EditorPane (chosen) | AuxiliaryBar |
|--------|---------------------|--------------|
| Width | Full editor width | Narrow side panel |
| Multiple conversations | Open as tabs, split view | Single view |
| Consistent with UX | Same as Calendar, Chart, Encounter | Different pattern |
| Side-by-side | Calendar left, Messages right | Can't split |
| Sidebar pairing | Click channel → opens editor (existing pattern) | Custom wiring |
| Thread view | Right split within editor | Overlay/slide-over |

### 4.2 Layout

```
┌──────────┬──────────────────────────┬──────────────────────────┐
│ MESSAGES │  📅 Calendar    ×  │  💬 #general    ×  │  💬 Dr.Chen  × │
│          ├──────────────────────────┼──────────────────────────┤
│ CHANNELS │                          │  #general                │
│ # general│   Tuesday, April 8      │  ───────────────────────  │
│ # clinic │                          │                          │
│ # billing│   ┌─────┐ ┌─────┐      │  SC  Sarah Chen  10:32   │
│          │   │ 9AM │ │10AM │      │  Hey @DrPatel, the lab   │
│ DMs      │   │Smith│ │Jones│      │  results for Martinez    │
│ 🟢 Sarah │   └─────┘ └─────┘      │  are in. LDL elevated.   │
│ 🟡 Robert│                          │  📎 martinez-labs.pdf    │
│          │                          │  👍 3  ❤️ 1  💬 2 replies│
│ PATIENTS │                          │                          │
│ 🔴 Leo R.│                          │  RP  Dr. Patel  10:35   │
│   Maria  │                          │  Thanks, I'll review     │
│          │                          │                          │
│          │                          │  ─────────────────────── │
│          │                          │  [📎] Type a message...  │
└──────────┴──────────────────────────┴──────────────────────────┘
│  👤 Michael Chen  🏥 Sunrise Family  💬 5 unread                │
└──────────────────────────────────────────────────────────────────┘
```

**Key UX patterns:**
- Click `#general` in sidebar → opens as editor tab (like clicking a patient opens chart)
- Click `Dr. Chen` DM → opens as another editor tab
- Drag tabs to split — Calendar left, Messages right
- Multiple conversations open simultaneously as tabs
- Thread replies open in a right split (SIDE_GROUP) within the editor

### 4.3 Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Editor Area (EditorPane)                                    │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  MessagingEditor (EditorPane)                           │ │
│  │  extends EditorPane, like PatientChartEditor            │ │
│  │                                                          │ │
│  │  ├── ChannelHeader                                      │ │
│  │  │   ├── Channel name + type icon (# 👤 👥)            │ │
│  │  │   ├── Topic (editable for admins)                    │ │
│  │  │   ├── Member count → popover                         │ │
│  │  │   ├── 🔍 Search  📌 Pinned  ⚙️ Settings             │ │
│  │  │                                                       │ │
│  │  ├── MessageList (scrollable, load-more on scroll up)   │ │
│  │  │   ├── DateSeparator ("Today", "Yesterday")           │ │
│  │  │   ├── MessageBubble                                  │ │
│  │  │   │   ├── Avatar (colored initials)                  │ │
│  │  │   │   ├── SenderName + Timestamp                     │ │
│  │  │   │   ├── Content (markdown)                         │ │
│  │  │   │   ├── Attachments (file cards)                   │ │
│  │  │   │   ├── Reactions (emoji + count badges)           │ │
│  │  │   │   ├── ThreadPreview ("💬 3 replies")             │ │
│  │  │   │   └── HoverActions (react, reply, pin, more)     │ │
│  │  │                                                       │ │
│  │  └── ComposeBar                                         │ │
│  │      ├── Attach button (📎)                             │ │
│  │      ├── Input (multi-line, @mention autocomplete)      │ │
│  │      └── Send button                                    │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Sidebar (Activity Bar → 💬 icon)                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  ChannelListPane (ViewPane)                             │ │
│  │  ├── SearchBar                                          │ │
│  │  ├── CHANNELS                                           │ │
│  │  │   ├── # general          (3 unread)                  │ │
│  │  │   ├── # clinical-notes                               │ │
│  │  │   ├── # billing-team     (1 unread)                  │ │
│  │  │   └── + Add Channel                                  │ │
│  │  ├── DIRECT MESSAGES                                    │ │
│  │  │   ├── 🟢 Dr. Sarah Williams                         │ │
│  │  │   ├── 🟡 Dr. Robert Kumar    (2 unread)             │ │
│  │  │   ├── 👥 Billing Team (3)                            │ │
│  │  │   └── + New Message                                  │ │
│  │  └── PATIENT MESSAGES                                   │ │
│  │      ├── Leo Rogers          (1 unread)                 │ │
│  │      ├── Maria Garcia                                   │ │
│  │      └── Thomas Moore                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 EditorInput + EditorPane

Follows the same pattern as `PatientChartEditorInput` / `PatientChartEditor`:

```typescript
// MessagingEditorInput — one per channel/DM
export class MessagingEditorInput extends EditorInput {
    static readonly TYPE_ID = 'workbench.input.ciyexMessaging';
    readonly channelId: string;
    readonly channelName: string;
    readonly channelType: 'public' | 'private' | 'dm' | 'group_dm';

    get typeId() { return MessagingEditorInput.TYPE_ID; }
    get resource() { return URI.from({ scheme: 'ciyex', path: `/messaging/${this.channelId}` }); }
    getName() { return this.channelType === 'dm' ? this.channelName : `#${this.channelName}`; }
    getIcon() { return this.channelType === 'dm' ? ThemeIcon('account') : ThemeIcon('comment-discussion'); }
}

// MessagingEditor — renders the conversation
export class MessagingEditor extends EditorPane {
    static readonly ID = 'ciyex.messagingEditor';
    // Renders: header, message list, compose bar
    // Same lifecycle as PatientChartEditor (setInput → renderBody → layout)
}
```

### 4.5 Sidebar ↔ Editor Pairing

```typescript
// Click channel in sidebar → opens MessagingEditor tab
row.addEventListener('click', () => {
    const input = new MessagingEditorInput(channel.id, channel.name, channel.type);
    this.editorService.openEditor(input, { pinned: true });
});

// Bidirectional: clicking message editor tab → switches sidebar to Messaging
const editorToSidebar = {
    'workbench.input.ciyexMessaging': 'ciyex.messaging',
    // ... existing mappings
};
```

### 4.6 Thread View (Right Split)

When user clicks "💬 3 replies" on a message, the thread opens in a **right split editor**:

```
┌──────────────────────────┬──────────────────────────┐
│  💬 #general             │  🧵 Thread               │
│  ───────────────────     │  ───────────────────      │
│  SC  Sarah Chen  10:32   │  SC  Sarah Chen  10:32   │
│  Lab results for         │  Lab results for         │
│  Martinez are in.        │  Martinez are in.        │
│  💬 3 replies ◄─click    │                          │
│                          │  RP  Dr. Patel  10:35    │
│  RP  Dr. Patel  10:40    │  Thanks, I'll review     │
│  New patient arrived     │                          │
│                          │  MC  Michael Chen 10:38  │
│                          │  LDL is 185, recommend   │
│                          │  statin therapy           │
│                          │                          │
│  ─────────────────────── │  ─────────────────────── │
│  [📎] Type a message...  │  [📎] Reply in thread... │
└──────────────────────────┴──────────────────────────┘
```

```typescript
// Open thread as split editor
const threadInput = new MessagingEditorInput(channelId, `Thread`, 'public', { threadParentId: messageId });
this.editorService.openEditor(threadInput, { pinned: false }, SIDE_GROUP);
```

---

## 5. Implementation Details

### 5.1 File Structure

```
src/vs/workbench/contrib/ciyexEhr/browser/
├── messaging/
│   ├── channelListPane.ts          # Sidebar: channel/DM list (ViewPane)
│   ├── messagingEditor.ts          # Editor: conversation view (EditorPane)
│   ├── messagingEditorInput.ts     # EditorInput for messaging tabs
│   ├── messagingService.ts         # API client for messaging endpoints
│   ├── messagingContribution.ts    # View container + editor + command registration
│   └── messagingTypes.ts           # TypeScript interfaces
```

### 5.2 Data Types

```typescript
interface Channel {
    id: string;
    name: string;
    type: 'public' | 'private' | 'dm' | 'group_dm';
    topic?: string;
    description?: string;
    unreadCount: number;
    lastMessage?: Message;
    members: ChannelMember[];
    archived: boolean;
}

interface Message {
    id: string;
    channelId: string;
    senderId: string;
    senderName: string;
    content: string;
    parentId?: string;        // Thread parent
    replyCount: number;
    reactions: Reaction[];
    attachments: Attachment[];
    mentions: string[];       // User IDs mentioned
    pinned: boolean;
    edited: boolean;
    deleted: boolean;
    system: boolean;          // System message (join/leave/pin)
    systemType?: string;
    createdAt: string;
    updatedAt: string;
}

interface Reaction {
    emoji: string;
    count: number;
    users: string[];
    includesMe: boolean;
}

interface Attachment {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    fileUrl: string;
    thumbnailUrl?: string;
}

interface ChannelMember {
    userId: string;
    displayName: string;
    role: 'owner' | 'admin' | 'member';
    lastReadAt: string;
    muted: boolean;
    online?: boolean;
}
```

### 5.3 Channel List Sidebar (channelListPane.ts)

Rendered as a **ViewPane** in the sidebar, grouped by section:

```typescript
export class ChannelListPane extends ViewPane {
    static readonly ID = 'ciyex.messaging.channels';

    // Sections rendered as collapsible groups:
    // 1. CHANNELS — public/private channels with # prefix
    // 2. DIRECT MESSAGES — 1:1 and group DMs with avatar
    // 3. PATIENT MESSAGES — DMs with patients (from portal)

    // Each item shows:
    // - Channel name or user name
    // - Unread badge (bold count)
    // - Online status dot (green/yellow/gray)
    // - Last message preview (truncated)
    // - Timestamp of last message

    // Toolbar:
    // - Search (filter channels)
    // - + New Channel
    // - + New DM
    // - 🔔 Notification preferences

    // Click → opens channel in AuxiliaryBar messaging view
    // Right-click → context menu: Mute, Mark read, Leave, Archive
}
```

### 5.4 Message View (messagingViewPane.ts)

Rendered as a **ViewPane** in the AuxiliaryBar (right panel):

```typescript
export class MessagingViewPane extends ViewPane {
    static readonly ID = 'ciyex.messaging.view';

    // Header:
    // - Channel name + type icon (# or 👤 or 👥)
    // - Topic (editable for admins)
    // - Member count → click shows member list
    // - 🔍 Search in channel
    // - 📌 Pinned messages
    // - ⚙️ Channel settings

    // Message list (scrollable, load-more on scroll up):
    // - Date separators ("Today", "Yesterday", "Apr 7")
    // - Message bubbles with:
    //   - Avatar (colored initials, same as encounter list)
    //   - Sender name (bold) + timestamp
    //   - Content (markdown rendered)
    //   - Reactions bar (emoji + count, click to toggle)
    //   - Thread preview ("💬 3 replies, last by Dr. Chen")
    //   - Attachments (file cards with icon + name + size)
    // - Hover actions: 😀 React, 💬 Reply, 📌 Pin, ··· More

    // Compose bar:
    // - Multi-line input (textarea, Enter to send, Shift+Enter for newline)
    // - 📎 Attach file button
    // - @ Mention autocomplete (triggers on @)
    // - Send button (or Enter)

    // Thread slide-over:
    // - When "Reply" clicked, slides a thread panel over the message list
    // - Shows parent message + all replies
    // - Has its own compose bar
    // - "Back" button to return to channel view
}
```

### 5.5 Real-Time Updates

**Current:** Polling every 30s (no WebSocket in backend).

**Proposed:** Add WebSocket support via STOMP:

```
Client                          Server (ciyex-api)
  │                                  │
  │  SUBSCRIBE /topic/channel/{id}   │
  │ ────────────────────────────►    │
  │                                  │
  │  MESSAGE (new message)           │
  │ ◄────────────────────────────    │  ← When someone sends a message
  │                                  │
  │  MESSAGE (typing indicator)      │
  │ ◄────────────────────────────    │  ← When someone starts typing
  │                                  │
  │  MESSAGE (reaction added)        │
  │ ◄────────────────────────────    │  ← When someone reacts
```

**Fallback:** If WebSocket not available, poll `/api/channels/{id}/messages?since={lastTimestamp}` every 5s for active channel, 30s for inactive.

### 5.6 Notification Integration

```typescript
// When new message arrives in non-active channel:
vscode.window.showInformationMessage(
    `💬 ${senderName} in #${channelName}: ${preview}`,
    'View', 'Mute'
).then(choice => {
    if (choice === 'View') {
        vscode.commands.executeCommand('ciyex.messaging.openChannel', channelId);
    }
});

// Status bar unread count:
statusbarService.addEntry({
    text: `$(comment-discussion) ${totalUnread}`,
    tooltip: `${totalUnread} unread messages`,
    command: 'ciyex.messaging.focus',
}, 'ciyex.messaging.unread', StatusbarAlignment.RIGHT, 97);
```

---

## 6. UI Design (Slack-Inspired, VS Code Native)

### 6.1 Color Palette

Use VS Code theme tokens for full dark/light theme support:

```
Background:        var(--vscode-sideBar-background)
Message hover:     var(--vscode-list-hoverBackground)
Unread badge:      var(--vscode-badge-background)
Mention highlight: rgba(0, 122, 204, 0.15)   /* blue tint */
My message:        var(--vscode-editor-background)
System message:    var(--vscode-descriptionForeground) italic
Link:              var(--vscode-textLink-foreground)
Border:            var(--vscode-editorWidget-border)
Input:             var(--vscode-input-background)
Send button:       var(--vscode-button-background)
Online dot:        #22c55e (green)
Away dot:          #f59e0b (amber)
Offline dot:       #6b7280 (gray)
```

### 6.2 Message Bubble Layout

```
┌──────────────────────────────────────────────────────┐
│ [SC] Sarah Chen          10:35 AM                    │
│                                                       │
│ Hey @DrPatel, the lab results for Martinez are in.   │
│ Looks like the CBC is within normal range but         │
│ lipid panel shows elevated LDL.                       │
│                                                       │
│ 📎 martinez-labs-04082026.pdf (245 KB)               │
│                                                       │
│ 👍 3   ❤️ 1   💬 2 replies                           │
└──────────────────────────────────────────────────────┘
```

### 6.3 Channel List Item

```
┌──────────────────────────────────────────────────────┐
│ # general                              3  10:35 AM   │
│   Patient in Room 3 is ready for...                   │
├──────────────────────────────────────────────────────┤
│ 🟢 Dr. Sarah Williams                     10:32 AM   │
│   Thanks, heading over                                │
├──────────────────────────────────────────────────────┤
│ 🟡 Dr. Robert Kumar                   2   10:15 AM   │
│   Can you review the claim for...                     │
└──────────────────────────────────────────────────────┘
```

### 6.4 Compose Bar

```
┌──────────────────────────────────────────────────────┐
│ 📎  Type a message...                          Send ▶ │
│     @mention (Tab to complete)                        │
└──────────────────────────────────────────────────────┘
```

---

## 7. API Mapping

All endpoints already exist in `MessagingController.java`:

| Action | VS Code Command | API Endpoint |
|--------|----------------|-------------|
| Load channels | Auto on login | `GET /api/channels` |
| Open channel | Click sidebar item | `GET /api/channels/{id}/messages?limit=50` |
| Send message | Enter in compose | `POST /api/channels/{id}/messages` |
| Reply in thread | Click "Reply" | `POST /api/channels/{id}/messages` (with parentId) |
| React | Click emoji | `POST /api/messages/{id}/reactions` |
| Pin message | Context menu | `POST /api/messages/{id}/pin` |
| Edit message | Context menu | `PUT /api/messages/{id}` |
| Delete message | Context menu | `DELETE /api/messages/{id}` |
| Upload file | Click 📎 | `POST /api/messages/{id}/attachments` |
| Search messages | Click 🔍 | `GET /api/messages/search?q=` |
| Create channel | Click + | `POST /api/channels` |
| Start DM | Click + New Message | `POST /api/channels/dm` |
| Mark read | Auto on view | `POST /api/channels/{id}/read` |
| Get members | Click member count | `GET /api/channels/{id}/members` |

---

## 8. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+M` | Toggle messaging panel |
| `Cmd+K` | Quick channel switcher (like Slack Cmd+K) |
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `@` | Trigger mention autocomplete |
| `Escape` | Close thread panel / Close search |
| `Cmd+F` | Search in current channel |
| `Up Arrow` | Edit last message (when input is empty) |

---

## 9. Patient Messaging

Patient messages come through the portal and appear in the **PATIENT MESSAGES** section:

```
PATIENT MESSAGES
├── 🔴 Leo Rogers (1 unread)
│   "Can I reschedule my appointment..."
├── Maria Garcia
│   "Thank you for the prescription"
└── Thomas Moore
    "My lab results question"
```

Patient DMs use the same API (`/api/channels/dm`) but are tagged with patient context. Staff can:
- Reply to patient messages
- Attach documents (lab results, instructions)
- Forward to another provider

---

## 10. Integration Points

### 10.1 Patient Chart → Message

From the patient chart, staff can click "Message" to start a DM with the patient:

```typescript
// In patientChartEditor.ts
const msgBtn = DOM.append(headerActions, DOM.$('button'));
msgBtn.textContent = '💬 Message';
msgBtn.addEventListener('click', () => {
    this.commandService.executeCommand('ciyex.messaging.startDM', patientId, patientName);
});
```

### 10.2 Encounter → Message

From an encounter, staff can share encounter details in a channel:

```typescript
// Share encounter in a channel
vscode.commands.executeCommand('ciyex.messaging.shareInChannel', {
    type: 'encounter',
    encounterId,
    patientName,
    summary: `${encounterType} - ${providerName} - ${date}`
});
```

### 10.3 Calendar → Message

From the calendar, click an appointment to message the patient or provider:

```typescript
// Quick message from appointment
vscode.commands.executeCommand('ciyex.messaging.quickMessage', {
    recipientId: appointment.providerId,
    context: `Re: ${appointment.patientName} at ${appointment.time}`
});
```

### 10.4 Sidebar ↔ Editor Pairing

Follows the existing bidirectional pairing pattern (same as Calendar, Patients, Encounters):

```typescript
// In ciyexEhrContribution.ts _setupSidebarEditorPairing()
const editorToSidebar = {
    'workbench.input.ciyexCalendar': 'ciyex.calendar',
    'workbench.input.ciyexPatientChart': 'ciyex.patients',
    'workbench.input.ciyexEncounterForm': 'ciyex.encounters',
    'workbench.input.ciyexMessaging': 'ciyex.messaging',   // ← NEW
};

const sidebarToEditor = {
    'ciyex.calendar': 'ciyex.openCalendar',
    'ciyex.messaging': 'ciyex.openMessaging',              // ← NEW
};
```

---

## 11. Implementation Phases

### Phase 1: Channel List + Basic Messaging (1 week)
- [ ] `ChannelListPane` in sidebar (channels, DMs, unread counts)
- [ ] `MessagingViewPane` in AuxiliaryBar (message list + compose)
- [ ] View container + activity bar icon
- [ ] Load channels on auth
- [ ] Send/receive messages (polling)
- [ ] Mark read on view

### Phase 2: Rich Features (1 week)
- [ ] Emoji reactions (click to toggle)
- [ ] Message threading (reply panel)
- [ ] File attachments (upload/download)
- [ ] @mention autocomplete
- [ ] Message search
- [ ] Pin/unpin messages

### Phase 3: Polish (1 week)
- [ ] Notification toasts for new messages
- [ ] Status bar unread count
- [ ] Keyboard shortcuts
- [ ] Channel create/edit dialog
- [ ] Member management
- [ ] Patient messaging section
- [ ] Integration with chart/encounter/calendar

### Phase 4: Real-Time (Future)
- [ ] WebSocket/STOMP for live updates
- [ ] Typing indicators
- [ ] Online presence dots
- [ ] Read receipts (per-message)

---

## 12. Open Questions

| # | Question | Recommendation |
|---|----------|---------------|
| 1 | AuxiliaryBar vs Panel (bottom) for message view? | **AuxiliaryBar** — always visible alongside main editor, like Slack's right panel |
| 2 | Polling interval for messages? | **5s** for active channel, **30s** for unread check, **WebSocket** when available |
| 3 | Message limit per load? | **50** messages, load more on scroll up |
| 4 | Should patient messages be separate from staff? | **Yes** — separate section in sidebar, same view in AuxiliaryBar |
| 5 | Markdown rendering in messages? | **Yes** — bold, italic, code, links, lists (same as VS Code markdown) |
| 6 | Max attachment size? | **25 MB** (match existing backend limit) |
