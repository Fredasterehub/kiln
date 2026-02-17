---
name: kiln-lore
description: Curated philosophical quotes for pipeline transition messages
user_invocable: false
---

# Kiln Lore

This skill provides curated philosophical quotes for all pipeline transition points in the Kiln orchestration workflow.

## Reading Protocol

The orchestrator reads ONLY the relevant transition section when displaying a transition message. The AI selects one quote contextually based on the current situation — no shell commands, no awk, no modulo arithmetic. The AI is the selection mechanism.

**Transition Message Format** (see § Rendering Protocol below for colored output):
```
━━━ [Title] ━━━
"[Quote]" -- [Attribution]

[One-line status. Action ->]
```

Max 4 lines, no emoji. Whitespace is intentional (ma — negative space).

## Rendering Protocol

The orchestrator and agent skills **must not** output transition quotes as plain markdown text.
Use Bash printf with ANSI escapes so the colors survive Claude Code's output stream.

### Step 1: Display the quote

```bash
printf '\033[38;5;179m━━━ %s ━━━\033[0m\n\033[38;5;222m"%s"\033[0m \033[2m-- %s\033[0m\n\n\033[2m%s\033[0m\n' \
  "$title" "$quote" "$attribution" "$status_line"
```

Color legend:
- `38;5;179` — muted gold (divider bars and title)
- `38;5;222` — warm gold (the quote text — key visual pop)
- `2m` — dim (attribution and status line)

Variable values are caller-supplied:
- `$title` — transition label (e.g., "Cooling", "Phase 2 Complete")
- `$quote` — quote text without surrounding quotes
- `$attribution` — author / source
- `$status_line` — one-line status + action hint (e.g., "State saved. The kiln holds its heat. Run /kiln:fire to resume.")

### Step 2: Write last-quote.json

After displaying, persist the selected quote so the status line script can show it:

```bash
printf '{"quote":"%s","by":"%s","section":"%s","at":"%s"}\n' \
  "$quote" "$attribution" "$section" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > .kiln/last-quote.json
```

Where `$section` is the lore section name (e.g., `pause-cool`, `phase-complete`).

Only write this file when `.kiln/` exists (`test -d .kiln` first).

---

## ignition

- "The creation of a thousand forests is in one acorn." -- Ralph Waldo Emerson
- "Every new beginning comes from some other beginning's end." -- Seneca
- "Imagination is more important than knowledge. For knowledge is limited, whereas imagination embraces the entire world." -- Albert Einstein
- "A journey of a thousand miles begins with a single step." -- Lao Tzu
- "In every outthrust headland, in every curving beach, in every grain of sand there is the story of the earth." -- Rachel Carson

## brainstorm-start

- "The mind is not a vessel to be filled, but a fire to be kindled." -- Plutarch
- "Every child is an artist. The problem is how to remain an artist once we grow up." -- Pablo Picasso
- "Wisdom is like a baobab tree; no one individual can embrace it." -- African proverb
- "In the beginner's mind there are many possibilities, but in the expert's there are few." -- Shunryu Suzuki
- "The cure for boredom is curiosity. There is no cure for curiosity." -- Dorothy Parker

## vision-approved

- "The only thing worse than being blind is having sight but no vision." -- Helen Keller
- "If you want to build a ship, don't drum up the men to gather wood, divide the work, and give orders. Instead, teach them to yearn for the vast and endless sea." -- Antoine de Saint-Exupery
- "Vision is the art of seeing what is invisible to others." -- Jonathan Swift
- "The real voyage of discovery consists not in seeking new landscapes, but in having new eyes." -- Marcel Proust
- "The best way to predict the future is to invent it." -- Alan Kay

## roadmap-start

- "Before anything else, preparation is the key to success." -- Alexander Graham Bell
- "Strategy without tactics is the slowest route to victory. Tactics without strategy is the noise before defeat." -- Sun Tzu
- "Would you tell me, please, which way I ought to go from here?" "That depends a good deal on where you want to get to." -- Lewis Carroll
- "The map is not the territory." -- Alfred Korzybski
- "Plans are worthless, but planning is everything." -- Dwight D. Eisenhower

## roadmap-approved

- "Give me six hours to chop down a tree and I will spend the first four sharpening the axe." -- attributed to Abraham Lincoln
- "The essence of strategy is choosing what not to do." -- Michael Porter
- "Strategy is a commodity, execution is an art." -- Peter Drucker
- "The time to repair the roof is when the sun is shining." -- John F. Kennedy
- "Forewarned, forearmed; to be prepared is half the victory." -- Miguel de Cervantes

## phase-start

- "We are what we repeatedly do. Excellence, then, is not an act, but a habit." -- Aristotle
- "Start where you are. Use what you have. Do what you can." -- Arthur Ashe
- "The master has failed more times than the beginner has even tried." -- Stephen McCranie
- "Discipline is the bridge between goals and accomplishment." -- Jim Rohn
- "Fall seven times, stand up eight." -- Japanese proverb

## plan

- "The details are not the details. They make the design." -- Charles Eames
- "Simplicity is the ultimate sophistication." -- Leonardo da Vinci
- "Form follows function." -- Louis Sullivan
- "You can't connect the dots looking forward; you can only connect them looking backwards." -- Steve Jobs
- "A good plan violently executed now is better than a perfect plan executed next week." -- George S. Patton

## validate

- "The first principle is that you must not fool yourself — and you are the easiest person to fool." -- Richard Feynman
- "Nothing in life is to be feared, it is only to be understood. Now is the time to understand more, so that we may fear less." -- Marie Curie
- "Everything we hear is an opinion, not a fact. Everything we see is a perspective, not the truth." -- attributed to Marcus Aurelius
- "Science is a way of thinking much more than it is a body of knowledge." -- Carl Sagan
- "Trust, but verify." -- Russian proverb

## execute

- "Whatever you can do, or dream you can do, begin it. Boldness has genius, power, and magic in it." -- Johann Wolfgang von Goethe
- "We don't rise to the level of our expectations, we fall to the level of our training." -- Archilochus
- "The craftsman is proud of what he has made, and cherishes it, while the consumer discards things that are perfectly serviceable in his restless pursuit of the new." -- Richard Sennett
- "The way to get started is to quit talking and begin doing." -- Walt Disney
- "Do or do not. There is no try." -- Yoda

## e2e

- "Doubt is not a pleasant condition, but certainty is absurd." -- Voltaire
- "In God we trust. All others must bring data." -- W. Edwards Deming
- "The proof of the pudding is in the eating." -- English proverb
- "One experiment is worth a thousand expert opinions." -- attributed to Bill Nye
- "Testing leads to failure, and failure leads to understanding." -- Burt Rutan

## review

- "I saw the angel in the marble and carved until I set him free." -- Michelangelo
- "Have no fear of perfection — you'll never reach it." -- Salvador Dali
- "Kaizen: continuous improvement in small increments." -- Japanese philosophy
- "Criticism may not be agreeable, but it is necessary." -- Winston Churchill
- "Creativity requires the courage to let go of certainties." -- Erich Fromm

## reconcile

- "The unlike is joined together, and from differences results the most beautiful harmony." -- Heraclitus
- "No man is an island, entire of itself; every man is a piece of the continent." -- John Donne
- "The meeting of two personalities is like the contact of two chemical substances: if there is any reaction, both are transformed." -- Carl Jung
- "In the confrontation between the stream and the rock, the stream always wins — not through strength but by perseverance." -- H. Jackson Brown Jr.
- "Unity is strength, division is weakness." -- Swahili proverb

## phase-complete

- "It does not matter how slowly you go as long as you do not stop." -- Confucius
- "Progress is impossible without change, and those who cannot change their minds cannot change anything." -- George Bernard Shaw
- "The most effective way to do it, is to do it." -- Amelia Earhart
- "Perseverance is not a long race; it is many short races one after the other." -- Walter Elliot
- "Success is the sum of small efforts, repeated day in and day out." -- Robert Collier

## all-phases-complete

- "The end of all our exploring will be to arrive where we started and know the place for the first time." -- T.S. Eliot
- "I fear not the man who has practiced 10,000 kicks once, but I fear the man who has practiced one kick 10,000 times." -- Bruce Lee
- "The work praises the man." -- Irish proverb
- "It is not the mountain we conquer, but ourselves." -- Edmund Hillary
- "Quality means doing it right when no one is looking." -- Henry Ford

## project-done

- "What you leave behind is not what is engraved in stone monuments, but what is woven into the lives of others." -- Pericles
- "No legacy is so rich as honesty." -- William Shakespeare
- "The two most important days in your life are the day you are born and the day you find out why." -- attributed to Mark Twain
- "The legacy we leave is not just in our buildings, but in the lives we touch." -- attributed to Maya Angelou
- "Well done is better than well said." -- Benjamin Franklin

## halt

- "I have not failed. I've just found 10,000 ways that won't work." -- Thomas Edison
- "Ever tried. Ever failed. No matter. Try again. Fail again. Fail better." -- Samuel Beckett
- "The brick walls are there for a reason. They're not there to keep us out. The brick walls are there to give us a chance to show how badly we want something." -- Randy Pausch
- "It is impossible for a man to learn what he thinks he already knows." -- Epictetus
- "Failure is the condiment that gives success its flavor." -- Truman Capote

## pause-cool

- "Almost everything will work again if you unplug it for a few minutes, including you." -- Anne Lamott
- "Ma: the space between, as important as form itself." -- Japanese aesthetic principle
- "You should sit in meditation for twenty minutes every day — unless you're too busy. Then you should sit for an hour." -- old wisdom
- "Patience is not the ability to wait, but the ability to keep a good attitude while waiting." -- attributed to Joyce Meyer
- "Rest is not idleness, and to lie sometimes on the grass under trees on a summer's day is by no means a waste of time." -- John Lubbock

## resume

- "Not all those who wander are lost." -- J.R.R. Tolkien
- "Life can only be understood backwards; but it must be lived forwards." -- Soren Kierkegaard
- "Though no one can go back and make a brand new start, anyone can start from now and make a brand new ending." -- Carl Bard
- "The phoenix must burn to emerge." -- Janet Fitch
- "The only way to make sense out of change is to plunge into it, move with it, and join the dance." -- Alan Watts
