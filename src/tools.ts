import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { getWsClient } from "./ws-send.js";

const KeywordRowSchema = Type.Object({
  分组: Type.String(),
  关键词: Type.String(),
  翻译: Type.String(),
  层级: Type.String(),
  优先级: Type.String(),
  精准度评分: Type.Union([Type.Integer(), Type.String()]),
  颜色: Type.String(),
  用途: Type.String(),
  参考搜索量: Type.Union([Type.Integer(), Type.String()]),
  参考自然排名: Type.Union([Type.Integer(), Type.String()]),
  关键词来源: Type.String(),
  风险标记: Type.String(),
  建议广告组: Type.String(),
  备注: Type.String(),
});

const ExactRowSchema = Type.Object({
  分组: Type.String(),
  匹配方式: Type.String(),
  关键词: Type.String(),
  翻译: Type.String(),
  优先级: Type.String(),
  精准度评分: Type.Union([Type.Integer(), Type.String()]),
  颜色: Type.String(),
  用途: Type.String(),
  参考搜索量: Type.Union([Type.Integer(), Type.String()]),
  参考自然排名: Type.Union([Type.Integer(), Type.String()]),
  关键词来源: Type.String(),
  风险标记: Type.String(),
  建议广告组: Type.String(),
  备注: Type.String(),
});

const SubmitKeywordSchema = Type.Object({
  task_id: Type.String({ description: "任务ID，从对话上下文中的 [task_id: xxx] 获取" }),
  sheet1: Type.Array(KeywordRowSchema, { description: "Sheet1 BMM广泛匹配关键词" }),
  sheet2: Type.Array(ExactRowSchema, { description: "Sheet2 Exact精准匹配关键词" }),
});

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function registerFastApiTools(api: OpenClawPluginApi) {
  api.registerTool(
    () => ({
      name: "submit_keyword_result",
      label: "Submit Keyword Result",
      description:
        "提交广告关键词生成结果。必须包含 task_id、sheet1（BMM广泛词）和 sheet2（Exact精准词）。" +
        "每条数据的所有字段必须填写，空值用\"无\"。",
      parameters: SubmitKeywordSchema,
      async execute(_toolCallId: string, params: unknown) {
        const p = params as {
          task_id: string;
          sheet1: Record<string, unknown>[];
          sheet2: Record<string, unknown>[];
        };

        const client = getWsClient();
        if (!client) {
          return json({ error: "WebSocket not connected" });
        }

        const sent = client.sendResult({
          task_id: p.task_id,
          status: "completed",
          content: JSON.stringify({ sheet1: p.sheet1, sheet2: p.sheet2 }),
          timestamp: Math.floor(Date.now() / 1000),
        });

        if (!sent) {
          return json({ error: "Failed to send result via WebSocket" });
        }

        return json({
          ok: true,
          message: `Submitted: sheet1=${p.sheet1.length} rows, sheet2=${p.sheet2.length} rows`,
        });
      },
    }),
    { name: "submit_keyword_result" },
  );
}
