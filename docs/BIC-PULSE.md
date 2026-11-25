# BIC Pulse

BIC Pulse is a single place for Tongmyong University (BIC) students to find what they need: official notices, their department’s announcements, and standing facts about the university. Instead of hunting across the website, KakaoTalk groups, and scattered office pages, students ask a question or browse one app.

This note describes the idea, the problems we are solving, and how the pieces join into one knowledge base that other tools can reuse.

## What we intend to do

University information is split in three places that do not talk to each other:

- **The public website** holds standing facts: colleges, admissions, dorms, visas, contacts, and similar material that changes slowly.
- **The notice board** holds time-sensitive posts: deadlines, events, registration windows, scholarship calls.
- **Department KakaoTalk chats** hold the messages students actually act on: class changes, submission reminders, department events.

BIC Pulse collects all three into one store, shows them in a simple student app, and adds a chat layer on top so a question such as “when is registration?” can use the handbook, the latest notices, and (when the student is signed in) that department’s chat messages.

Sign-up in the current app is lightweight and local. It exists so the app knows which department’s private announcements to show. Production-grade login is not the goal of this stage.

## How we solve each challenge

### 1. Notices from the university website

The notice board is public HTML. A small Python scraper visits the list pages, then each notice page, and copies title, date, body text, images, and file links. It does not rewrite the original post; it stores a clean copy and a link back to the source.

Those copies are sent into BIC Pulse through a notices ingest endpoint. The same notice is not stored twice: the original URL is the unique key, so the scraper can be run on a schedule without creating duplicates.

### 2. Department messages from KakaoTalk

Department groups live in KakaoTalk, not on the university website. Kakao does not offer a public feed of those rooms.

We solve this with a dedicated Android helper (KakaoDump2). On a phone that already has access to the relevant chats, the app reads the local KakaoTalk database, decrypts the message text, and tags each chat with a department name. Enabled chats are forwarded to BIC Pulse as batches of messages.

Each message is stored as a department announcement, marked as gated (not public), and keyed so the same chat line is not imported twice. In the student app, those messages appear only after the student has chosen that department. The same rule applies to Ask AI: a Computer Engineering student does not receive another department’s Kakao content.

### 3. Public university knowledge

Standing facts were gathered from public university pages: tu.ac.kr and related portals (admissions, international office, dormitory, library, and similar). That research was written up as a handbook (`tu_data.md`): colleges, procedures, contacts, campus services, and gaps where the public record was incomplete.

This handbook is the slow-changing layer. Notices and Kakao messages sit on top of it so answers about “what is happening now” can prefer recent posts over older handbook text.

### 4. A chat layer on top

Ask AI does not browse the live web for each question. It searches the unified knowledge base: handbook plus notices plus (when allowed) that department’s announcements.

Newer posts are favoured when the question is about events, deadlines, or schedules. If a notice disagrees with the handbook, the assistant is instructed to trust the newer notice and mention the date. If nothing relevant is in the store, it should say so rather than invent a date.

Students see which sources were used (handbook, notice, or department announcement).

## How it connects: one knowledge layer

```
Public website          Notice scraper         KakaoDump2 (dept chats)
       |                      |                         |
       v                      v                         v
  University handbook    Official notices        Gated announcements
       \                      |                         /
        \                     v                        /
         ----->  One content store  <------------------
                      |
                      +----> Student app (browse + Ask AI)
                      +----> Same store / ask API for other projects
```

Everything is stored in one place, with a source label (handbook, notice, or Kakao), a date, and whether it is public or department-only. The student app is the first product on that store. The store itself is the product we want to reuse: any later campus tool that needs a university knowledge base can read the same records or call the same question API instead of scraping tu.ac.kr and Kakao again.

## Tech stack (brief)

| Area | Choice |
| --- | --- |
| Student app | Next.js, React, TypeScript |
| Content store | SQLite |
| Notice collection | Python scraper |
| Kakao collection | Android app (KakaoDump2) |
| Ask AI | Python (LlamaIndex) with Google Gemini, called from the web app |

## What this is not

BIC Pulse is not an official Kakao product, not a replacement for the university website, and not a production identity system. It is a practical layer that gathers public university knowledge, official notices, and opted-in department chats so students (and later, other apps) can query one source of truth.
