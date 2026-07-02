import { Type } from "../pi-sdk/index.ts"
import { questionService } from "../question/question-service.ts"
import { t } from "../i18n.ts"

export function createQuestionTool() {
  return {
    name: "question",
    label: "Question",
    promptGuidelines: [
      "When you need the user to choose between options or provide preferences, ALWAYS use the `question` tool instead of asking in plain text.",
      "Do NOT ask open-ended questions in chat text — use the `question` tool with structured options so the user can click to answer rather than typing.",
      "For each question, provide clear options with labels and descriptions. Set `multiple: true` if the user can select more than one option.",
      "If the user's request has multiple independent decisions to make, call `question` once with all questions in a single array rather than making multiple sequential calls.",
    ].join("\n"),
    description:
      "Use this tool when you need to ask the user questions during execution. " +
      "This allows you to:\n" +
      "1. Gather user preferences or requirements\n" +
      "2. Clarify ambiguous instructions\n" +
      "3. Get decisions on implementation choices as you work\n" +
      "4. Offer choices to the user about what direction to take.\n\n" +
      "Usage notes:\n" +
      "- Answers are returned as arrays of labels; set `multiple: true` to allow selecting more than one\n" +
      "- If you recommend a specific option, make that the first option in the list and add \"(Recommended)\" at the end of the label",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: "Complete question" }),
          header: Type.String({ description: "Very short label (max 30 chars)" }),
          options: Type.Array(
            Type.Object({
              label: Type.String({ description: "Display text (1-5 words, concise)" }),
              description: Type.String({ description: "Explanation of choice" }),
            }),
            { description: "Available choices" },
          ),
          multiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple choices" })),
        }),
        { description: "Questions to ask" },
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const answers = await questionService.ask(
        ctx?.sessionPath,
        params.questions,
        (event, sp) => ctx?.emitEvent?.(event, sp || ctx?.sessionPath),
        _signal ?? undefined,
      )
      const formatted = params.questions
        .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : t("question.unanswered")}"`)
        .join(", ")
      return {
        content: [{ type: "text", text: t("question.answered", { answers: formatted }) }],
        details: { answers },
      }
    },
  }
}
