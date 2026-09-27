// Activities: things to do with the assistant about one item on the map, started from its
// Explore button. For now each is a prompt: an opening line the person sends, and instructions
// the assistant follows for the rest of that conversation. Shared by the app and the server.

export type Subject = "node" | "edge" | "loop" | "entry";

export interface Activity {
  id: string;
  label: string;
  /** What it does, in a line, under its label in the menu. */
  description: string;
  subjects: Subject[];
  /** The person's opening message, about `name`. */
  opener: (name: string) => string;
  /** How the assistant runs it. */
  instructions: string;
}

/** An activity started on one item: sent with the opening message so the server can follow it. */
export interface ActivityRequest {
  activity: string;
  subject: Subject;
  /** The item's id; a link's id with its ends ("e1 from n1 to n2"); a loop's node ids in order. */
  target: string;
  name: string;
}

export const ACTIVITIES: Activity[] = [
  {
    id: "dynamics",
    label: "Understand the dynamics",
    description: "Make sense of how it fits with what's around it",
    subjects: ["node", "edge", "loop", "entry"],
    opener: (name) => `Help me understand the dynamics around “${name}”.`,
    instructions: `Help them make sense of it. Read it and what is around it first (get_node,
find_related, find_loops, get_entry). Then say in plain words how it fits: what feeds it, what it
feeds, any loop keeping it going, and what it might be protecting or trying to achieve. Offer one
or two insights as possibilities to check, not conclusions, and end by asking whether that fits.
Don't change the map unless they ask.`,
  },
  {
    id: "inquiry",
    label: "Gather more info",
    description: "Answer a few questions, one at a time, to fill in the map",
    subjects: ["node", "edge", "loop", "entry"],
    opener: (name) => `Ask me some questions to learn more about “${name}”.`,
    instructions: `Run a short inquiry to fill in the map around it. Read what is already there,
then ask one open, gentle question at a time about what is missing: where it comes from, when it
shows up, how it feels in the body, who is involved, what it leads to. Wait for each answer. An
answer that tells you something new is writing about their life: record it and add what it says
to the map, then ask the next question. Stop after about five questions, or sooner if they want
to, and sum up what was added.`,
  },
  {
    id: "five_whys",
    label: "Five whys",
    description: "Ask why, again and again, to find what lies underneath",
    subjects: ["node", "loop"],
    opener: (name) => `Let's do five whys on “${name}”.`,
    instructions: `Guide a five whys. Ask why it happens or matters, one question at a time, each
building on their last answer and worded gently and differently each time, up to five times or
until they reach something that feels like the root. Then reflect the chain back in a few lines
and offer to add what surfaced to the map.`,
  },
  {
    id: "test_link",
    label: "Test the link",
    description: "Weigh whether it holds, and which way it goes",
    subjects: ["edge"],
    opener: (name) => `Does the link “${name}” hold up?`,
    instructions: `Weigh whether this link holds. Read both ends and the evidence for it, then say
plainly what supports it, what might not fit, and whether its direction and effect seem right.
Ask what their experience says, and offer to correct or remove it if it doesn't fit.`,
  },
  {
    id: "ease",
    label: "Find where it could ease",
    description: "Look for the step most open to change, and a small experiment",
    subjects: ["loop"],
    opener: (name) => `Where could the loop “${name}” ease?`,
    instructions: `Look for where this loop could ease. Walk it step by step and name the steps
most open to change: a belief that could be tested, a habit with an alternative, a trigger that
can be caught early. Suggest one small, kind experiment and ask which step feels most possible.
Loops usually protect something, so be gentle about it.`,
  },
  {
    id: "coverage",
    label: "Check the map covers it",
    description: "Find anything in it that isn't on the map yet",
    subjects: ["entry"],
    opener: (name) => `Does the map cover everything in “${name}”?`,
    instructions: `Check the map covers this entry. Read it with get_entry and see what on the map
already cites it. Name anything important in it that isn't on the map yet and offer to add it,
quoting the entry.`,
  },
];

export function activitiesFor(subject: Subject): Activity[] {
  return ACTIVITIES.filter((a) => a.subjects.includes(subject));
}

const HOW_TO_READ: Record<Subject, string> = {
  node: "get_node with its id",
  edge: "get_node on its ends; the link is",
  loop: "get_node on each, in loop order; the node ids are",
  entry: "get_entry with its id",
};

/** What the assistant is told for an activity started on one item, or "" for an unknown one. */
export function activityInstructions(request: ActivityRequest): string {
  const activity = ACTIVITIES.find((a) => a.id === request.activity);
  if (!activity) return "";
  return `\n\nThe person started this conversation from the Explore menu of one ${request.subject} on their map: “${request.name}” (read it with ${HOW_TO_READ[request.subject]} ${request.target}). Their opening message is a request, not writing about their life, so don't record it as an entry. Activity: ${activity.label}.\n${activity.instructions.replace(/\n/g, " ")}`;
}
