/**
 * Seed data for reviewResponseTemplates.
 * Built from analysis of 50 actual guest reviews across 7 J&A / ChezSoi Stays
 * properties (Jul 2026). Categories and language reflect real recurring patterns:
 *   - 84% 5★ (clean, as advertised, responsive host, great location)
 *   - 10% 4★ (good stay, minor issue resolved quickly)
 *   -  2% 3★ (value-ok, nothing special)
 *   -  4% 2★ (access lockout, pest/cleanliness complaint)
 *
 * Incentive options per Hasib RevOps framework (Jul 13 2026 meeting):
 *   - return_discount: 10% off next stay (Airbnb-compliant, offered after
 *     the review is posted, not in exchange for it)
 *   - google_review: ask for an off-platform Google review (builds company
 *     reputation outside Airbnb; compliant)
 *   - early_late_checkin: flexible check-in/out offer (Abdullah's tactic , 
 *     already working well for them)
 *   - none: warm thank-you, no transactional element
 */

export type TemplateInput = {
  reviewCategory: "glowing_5star" | "positive_4star" | "mixed_3star" | "critical_2star";
  incentive: "none" | "return_discount" | "google_review" | "early_late_checkin";
  label: string;
  opener: string;
  acknowledgment: string;
  addressIssue?: string;
  inviteBack: string;
  incentiveText: string;
  closer: string;
};

export const TEMPLATES: TemplateInput[] = [
  // ─── 5★ GLOWING ────────────────────────────────────────────────────────────

  {
    reviewCategory: "glowing_5star",
    incentive: "none",
    label: "5★ Glowing: Simple thank-you",
    opener: "Thank you so much for this wonderful review, [GUEST_NAME]! It truly made our day.",
    acknowledgment:
      "We're so glad you found the space clean, comfortable, and exactly as described, that's exactly the experience we work hard to deliver at [PROPERTY_NAME].",
    inviteBack: "We'd love to welcome you back whenever you're in the area!",
    incentiveText: "",
    closer: "Warm regards,\nChez Soi Stays",
  },
  {
    reviewCategory: "glowing_5star",
    incentive: "return_discount",
    label: "5★ Glowing: 10% return-stay discount",
    opener: "Thank you so much for this wonderful review, [GUEST_NAME]! You made our day.",
    acknowledgment:
      "We're thrilled you had such a great stay at [PROPERTY_NAME], knowing the space felt clean, welcoming, and exactly as described means everything to us.",
    inviteBack: "We'd love to have you back!",
    incentiveText:
      "As a small token of our appreciation, we'd like to offer you 10% off your next stay with us, just reach out directly before booking and we'll sort it out.",
    closer: "Until next time,\nChez Soi Stays",
  },
  {
    reviewCategory: "glowing_5star",
    incentive: "google_review",
    label: "5★ Glowing: Ask for Google review",
    opener: "Thank you so much for this glowing review, [GUEST_NAME], it means the world to us!",
    acknowledgment:
      "We love hearing that [PROPERTY_NAME] hit the mark on cleanliness, comfort, and responsiveness. That's the standard we hold ourselves to with every guest.",
    inviteBack: "We hope to host you again soon!",
    incentiveText:
      "If you have a spare moment, we'd be incredibly grateful if you could share a quick review on Google as well, it helps other travelers discover us and goes a long way for a small team like ours.",
    closer: "With gratitude,\nChez Soi Stays",
  },
  {
    reviewCategory: "glowing_5star",
    incentive: "early_late_checkin",
    label: "5★ Glowing: Offer early/late check-in",
    opener: "Thank you so much for this wonderful review, [GUEST_NAME]! Guests like you make hosting a joy.",
    acknowledgment:
      "It's great to know you enjoyed every aspect of your time at [PROPERTY_NAME]. We put a lot of care into making sure each guest feels right at home.",
    inviteBack: "Please come back anytime, we'd love to host you again.",
    incentiveText:
      "Next time you stay with us, just let us know your travel schedule and we'll do our best to arrange an early check-in or late checkout for you, on us.",
    closer: "See you next time,\nChez Soi Stays",
  },

  // ─── 4★ POSITIVE WITH MINOR NOTE ───────────────────────────────────────────

  {
    reviewCategory: "positive_4star",
    incentive: "none",
    label: "4★ Positive: Simple thank-you",
    opener: "Thank you for the kind review, [GUEST_NAME], and for choosing ChezSoi Stays!",
    acknowledgment:
      "We're glad the overall experience at [PROPERTY_NAME] was a positive one, and we appreciate you sharing your honest feedback, it helps us keep improving.",
    inviteBack: "We hope to see you again and give you a fully 5-star experience next time.",
    incentiveText: "",
    closer: "Best regards,\nChez Soi Stays",
  },
  {
    reviewCategory: "positive_4star",
    incentive: "return_discount",
    label: "4★ Positive: 10% return-stay discount",
    opener: "Thank you for your review, [GUEST_NAME], we really appreciate your feedback!",
    acknowledgment:
      "We're pleased you had a comfortable stay at [PROPERTY_NAME], and we take your comments seriously as we work toward making every experience a 5-star one.",
    inviteBack: "We'd love to welcome you back and show you what we're capable of.",
    incentiveText:
      "To say thank you, we'd like to offer 10% off your next booking with us, just reach out before you reserve and we'll make it happen.",
    closer: "Hope to see you again soon,\nChez Soi Stays",
  },
  {
    reviewCategory: "positive_4star",
    incentive: "google_review",
    label: "4★ Positive: Ask for Google review",
    opener: "Thank you for staying with us, [GUEST_NAME], and for taking the time to leave a review!",
    acknowledgment:
      "We're glad [PROPERTY_NAME] worked well for your trip. Your feedback keeps us accountable and motivates the team to keep raising the bar.",
    inviteBack: "We'd love a chance to earn that fifth star on your next visit.",
    incentiveText:
      "If you get a moment, a quick Google review would mean a lot to us, it helps other travelers find us and supports our small team in a big way.",
    closer: "With appreciation,\nChez Soi Stays",
  },
  {
    reviewCategory: "positive_4star",
    incentive: "early_late_checkin",
    label: "4★ Positive: Offer early/late check-in",
    opener: "Thank you for the review, [GUEST_NAME]! We're glad you had a good stay.",
    acknowledgment:
      "We appreciate the honest 4-star feedback on [PROPERTY_NAME], we're always looking for ways to close the gap and make every stay feel truly exceptional.",
    inviteBack: "We hope you'll give us another shot, we'd love to win that extra star.",
    incentiveText:
      "When you book again, drop us a message and we'll do our best to fit your schedule with an early check-in or late checkout at no extra cost.",
    closer: "Until next time,\nChez Soi Stays",
  },

  // ─── 3★ MIXED ───────────────────────────────────────────────────────────────

  {
    reviewCategory: "mixed_3star",
    incentive: "none",
    label: "3★ Mixed: Acknowledge & improve",
    opener: "Thank you for your honest feedback, [GUEST_NAME], we genuinely appreciate guests who take the time to share their experience.",
    acknowledgment:
      "We're sorry [PROPERTY_NAME] didn't fully meet your expectations. Your comments help us understand where to focus our energy.",
    addressIssue:
      "We've reviewed what happened carefully and are following up with our operations team so future guests receive a better experience.",
    inviteBack: "We hope you'll give us another opportunity to do better.",
    incentiveText: "",
    closer: "Respectfully,\nChez Soi Stays",
  },
  {
    reviewCategory: "mixed_3star",
    incentive: "return_discount",
    label: "3★ Mixed: 10% return-stay discount",
    opener: "Thank you for taking the time to share your experience, [GUEST_NAME].",
    acknowledgment:
      "We're sorry that your stay at [PROPERTY_NAME] was only average, that's not the standard we set for ourselves and we appreciate you letting us know.",
    addressIssue:
      "We've reviewed the points you raised with our operations team and are tightening the parts of the stay that fell short.",
    inviteBack: "We'd love a chance to make it right.",
    incentiveText:
      "As a gesture of goodwill, we'd like to offer you 10% off a future stay, please reach out directly and we'll honour it.",
    closer: "Thank you again,\nChez Soi Stays",
  },
  {
    reviewCategory: "mixed_3star",
    incentive: "google_review",
    label: "3★ Mixed: Ask for Google review",
    opener: "Thank you for your honest review, [GUEST_NAME].",
    acknowledgment:
      "We appreciate the balanced feedback on [PROPERTY_NAME]. Mixed experiences push us to improve and we take every point seriously.",
    addressIssue:
      "We're reviewing what you raised with the property team and using it to improve the experience for upcoming stays.",
    inviteBack: "We hope to have the chance to show you a better experience.",
    incentiveText:
      "If you're open to it, sharing your experience on Google (even the honest version) helps other travellers make informed choices and helps us understand our reputation outside Airbnb.",
    closer: "With appreciation,\nChez Soi Stays",
  },
  {
    reviewCategory: "mixed_3star",
    incentive: "early_late_checkin",
    label: "3★ Mixed: Offer early/late check-in",
    opener: "Thank you for your candid feedback, [GUEST_NAME], it matters to us.",
    acknowledgment:
      "We're sorry [PROPERTY_NAME] didn't hit all the right notes this time. We use feedback like yours to raise the bar for every future stay.",
    addressIssue:
      "We're taking the points you raised seriously and reviewing the stay with our operations team.",
    inviteBack: "We'd genuinely love the opportunity to win you back.",
    incentiveText:
      "If you ever stay with us again, just let us know your arrival and departure times and we'll do our best to accommodate an early check-in or late checkout.",
    closer: "Thank you again,\nChez Soi Stays",
  },

  // ─── 2★ CRITICAL ────────────────────────────────────────────────────────────

  {
    reviewCategory: "critical_2star",
    incentive: "none",
    label: "2★ Critical: Professional response",
    opener: "Thank you for sharing your experience, [GUEST_NAME]. We sincerely apologize that your stay at [PROPERTY_NAME] didn't meet expectations.",
    acknowledgment:
      "This is not the standard we hold ourselves to, and we take full responsibility for the issues you encountered.",
    addressIssue:
      "We've reviewed the full stay history with our operations team and are addressing the points that fell below our standard.",
    inviteBack: "We understand if you choose to stay elsewhere, but we hope you'll give us the opportunity to show you what we're truly capable of.",
    incentiveText: "",
    closer: "Sincerely,\nChez Soi Stays",
  },
  {
    reviewCategory: "critical_2star",
    incentive: "return_discount",
    label: "2★ Critical: 10% return-stay discount",
    opener: "Thank you for your honest review, [GUEST_NAME]. We are truly sorry that your experience at [PROPERTY_NAME] fell short.",
    acknowledgment:
      "The issues you raised are unacceptable and we've taken immediate steps to address them. Every guest deserves a smooth, comfortable stay, you did not get that, and we own it.",
    addressIssue:
      "We have reviewed the specifics of your stay with our operations team and are addressing the breakdowns you experienced.",
    inviteBack: "We'd genuinely like the chance to make it up to you.",
    incentiveText:
      "As a gesture of goodwill, we'd like to offer you 10% off a future stay, please reach out directly and we'll honour it, no questions asked.",
    closer: "With sincere apologies,\nChez Soi Stays",
  },
  {
    reviewCategory: "critical_2star",
    incentive: "google_review",
    label: "2★ Critical: Transparent public response",
    opener: "Thank you for taking the time to share your experience, [GUEST_NAME], even though we know it wasn't what you hoped for.",
    acknowledgment:
      "We are genuinely sorry your stay at [PROPERTY_NAME] was impacted by the issues you described. We want to be transparent: we've reviewed what happened and we've made changes.",
    addressIssue:
      "We have reviewed the stay communication carefully and are using it to strengthen the process for future guests.",
    inviteBack: "We appreciate honest feedback more than silence, it helps us improve for every guest who comes after you.",
    incentiveText: "",
    closer: "With appreciation for your candour,\nChez Soi Stays",
  },
  {
    reviewCategory: "critical_2star",
    incentive: "early_late_checkin",
    label: "2★ Critical: Flexible check-in offer",
    opener: "We sincerely apologize, [GUEST_NAME]. What you experienced at [PROPERTY_NAME] is not acceptable and not representative of our standard.",
    acknowledgment:
      "We've investigated your stay thoroughly and have taken corrective steps. Your comfort and safety matter to us, and we failed to deliver on that.",
    addressIssue:
      "We have reviewed the issue with our operations team and are reinforcing the process around it for future stays.",
    inviteBack: "We would genuinely love the chance to restore your confidence in us.",
    incentiveText:
      "If you're ever willing to give us another try, please reach out directly, we'll ensure a smooth arrival with an early check-in or late checkout arranged around your schedule.",
    closer: "With sincere apologies,\nChez Soi Stays",
  },
];
