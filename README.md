# MTG Videos

An archive of Magic: The Gathering creator videos and podcast episodes, on one page:
<https://oliviercavadenti.github.io/mtg-videos/>

The page files every video by **period**, then by **format**, then, for Limited and Cube, by
**set**. Each main set release opens a new period, named after the set. A video about a main set
goes to that set's period, even when it came out a few weeks before release (previews, set
reviews). Any other video goes by its publication date.

The archive starts on 1 January 2025 and is updated every hour from the creators' feeds.

A second page, <https://oliviercavadenti.github.io/mtg-videos/day/>, shows the videos of one day,
midnight to midnight in the reader's time zone, by format and set, with a link per day
(`day/?d=2026-11-20`), one day per page. The **video of the day** is the one with the most views against its creator's usual, when it has at
least half again as many.

## How it works

No server and no database. Everything is static files in this repository:

| Path | What it holds |
| --- | --- |
| `config/creators.json` | The creators followed, their feeds, and `historyStart` |
| `config/set-aliases.json` | Nicknames of sets in video titles ("Spider-Man", "TMNT") |
| `data/videos/{year}.json` | Every video, one per line: the archive itself |
| `data/sets.json` | Sets from Scryfall |
| `data/cards.json` | Name and colors of every card of those sets, to find cards in titles |
| `scripts/` | The data scripts (Node 22, TypeScript run with `tsx`) |
| `src/` | The page (Vite, plain TypeScript, no framework) |

A GitHub Action (`.github/workflows/update.yml`) runs every hour. It reads the feeds, commits the new
videos and publishes the page on GitHub Pages; once a day it also reads the sets and cards from Scryfall.

## Commands

```bash
npm install
npm run dev          # the page, with public/archive.json built from data/
npm run build        # type-check and production build into dist/
npm test

npm run sync         # read every feed and add the new videos
npm run sets         # refresh data/sets.json from Scryfall
npm run cards        # refresh data/cards.json from Scryfall
npm run reclassify   # apply the classification rules again (after editing them)
YOUTUBE_API_KEY=… npm run views      # read the views of videos a day old
YOUTUBE_API_KEY=… npm run backfill   # whole history back to historyStart
```

YouTube feeds only list the 15 latest uploads. `backfill` reads a channel's full history through
the YouTube Data API: its "UULF" playlist holds the videos without the Shorts, "UULV" the past
lives. Podcast feeds already hold their whole history.

## Classification

Each video gets formats (primary first), a kind (draft, set review, deck guide, tournament...) and,
when it is about one, a set:

- **Formats** come from the title: "Standard", "Pauper", "Premier Draft"... The show's own name is
  ignored, so an episode of Limited Resources about Cube is a Cube episode. When the title names
  no format, the creator's default format applies (`format` in `config/creators.json`), then their
  focus (a Limited-only channel makes Limited videos). Descriptions are not read: their boilerplate
  and decklists mislead.
- **Sets** come from a set named in the title (name, nickname or code in capitals), else the
  transcript when there is one. Otherwise, a Limited video goes to the Limited format of its day,
  and a set review to the main set due within five weeks.
- The videos imported from ManaRadar keep their language-model classification (formats, kind,
  archetypes, one-sentence summary). Their transcripts were only read to classify, never stored.
- A show published as both a podcast and videos (same `show` in the config) is listed once: the
  video, with a link to the podcast episode.

Edit the rules in `scripts/lib/classify.ts`, run `npm run reclassify`, and commit `data/`.

## Colors, archetypes and cards

`scripts/lib/tags.ts` reads three more things in a title:

- **Colors played**: a guild, shard, clan or Strixhaven college ("Simic", "Esper", "Lorehold"),
  "mono-red", "blue-black", capital letters ("UW", "RUG") or colored emoji (🔴⚪). The first one in
  the title gives the deck's colors. A title with all five emoji is decoration and counts for none.
- **Archetype**: that color term and the words naming the deck after it ("Simic Midrange",
  "Golgari Icetill"). A language model's archetypes, when it found some, are kept.
- **Cards**: names of cards from sets out within two years before the video. Names made only of
  common words ("Last Chance") and game terms ("Flashback") are not looked for.

Cards heard in a transcript come with the second they come up at: the page links each one to that
moment of the video. They were imported from ManaRadar, which transcribes recent videos with
faster-whisper and finds the cards of the sets it reviews. Transcripts themselves are not stored
here.

## Views and the video of the day

`npm run views` reads the YouTube views of each video once, the day after its release (the first
run read every older video). Reading them once keeps the data files from changing every day. A
video's score is its views divided by the median of its creator's other videos read at the same
stage: the 30 read the day after release before it, or, for older videos, those published within
two months around it. The hourly Action reads them with the `YOUTUBE_API_KEY` secret.

## Adding a creator

Add an entry to `config/creators.json`: a YouTube feed
(`https://www.youtube.com/feeds/videos.xml?channel_id=UC…`) or a podcast RSS feed. Then run
`npm run backfill -- --creator <id>` with a YouTube API key, or wait for the next hourly run, which
only picks up their latest uploads.

## Credits

Videos and episodes belong to their creators: the page only links to them. Thumbnails are loaded
from YouTube, set symbols from [Scryfall](https://scryfall.com). Not affiliated with Wizards of the
Coast. Magic: The Gathering is a trademark of Wizards of the Coast LLC.
