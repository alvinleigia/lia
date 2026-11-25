// Fictional documents. Each service has the same preamble before its own terms.
const serviceNotes = [
  "Bring your service reference to reception and describe any concerns to the adviser.",
  "Your adviser records the condition of the bicycle before the workshop starts work.",
  "The inspection includes a visual check of the frame, wheels, cables and handlebars.",
  "Replacement parts require your approval before the technician installs them.",
  "The team adds any approved parts to the work order and gives you a copy on collection.",
  "Please remove your lights, luggage and other accessories before handing over the bicycle.",
  "If another person collects the bicycle, give their name to the adviser at reception.",
  "The final inspection includes checking that all fitted accessories are secure.",
  "The service summary identifies any items the technician recommends checking again.",
  "Keep the receipt with the service summary in case you have questions about the work.",
  "Present the work order number if you call the workshop to discuss the inspection.",
  "The adviser explains the completed work when you collect your bicycle.",
].join("\n");

export const sectionGuides = [
  "Fern Plan\nBreakfast is included. A late checkout costs INR 600.\n\nBirch Plan\nBreakfast costs INR 450 per guest. The late checkout charge is unconfirmed.",
  `# Workshop\n## Copper Service\n${serviceNotes}\nPickup is available within 3 kilometres.\n## Silver Service\n${serviceNotes}\nPickup is available within 12 kilometres.`,
];

export const sectionQuestions = [
  {
    query: "Does the Fern Plan include breakfast?",
    title: "Fern Plan",
    term: "Breakfast is included.",
    sibling: "Birch Plan",
  },
  {
    query: "What does breakfast cost on the Birch Plan?",
    title: "Birch Plan",
    term: "INR 450",
    sibling: "Fern Plan",
  },
  {
    query: "How much is late checkout on the Fern Plan?",
    title: "Fern Plan",
    term: "INR 600",
    sibling: "Birch Plan",
  },
  {
    query: "Is late checkout INR 600 on the Birch Plan too?",
    title: "Birch Plan",
    term: "late checkout charge is unconfirmed",
    sibling: "Fern Plan",
  },
  {
    query: "How far will you collect a bike for the Copper Service?",
    title: "Copper Service",
    term: "3 kilometres",
    sibling: "Silver Service",
  },
  {
    query:
      "Does the Silver Service include bike pickup from 10 kilometres away?",
    title: "Silver Service",
    term: "12 kilometres",
    sibling: "Copper Service",
  },
];
