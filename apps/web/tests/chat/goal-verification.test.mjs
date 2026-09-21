import assert from "node:assert/strict";
import test from "node:test";
import { verificationSummary } from "../../lib/chat/goal-verification.ts";

const text = (_en, zh) => zh;
test("only the accepted backend verdict produces a completion summary", () => {
  assert.equal(verificationSummary({id:"v", status:"pending"}, "done", text), "正在核对验收结果…");
  assert.equal(verificationSummary({id:"v", status:"unavailable"}, "done", text), "验收结果未确认");
  assert.equal(verificationSummary({id:"v", status:"pending"}, "cancelled", text), "验收已取消");
  assert.equal(verificationSummary({id:"v", status:"met", requirements:[{id:"todo:0",verdict:"met"},{id:"todo:1",verdict:"met"}]}, "done", text), "Goal 已完成，2/2 项待办通过验收");
  assert.equal(verificationSummary({id:"v", status:"unmet"}, "done", text), "验收未通过，仍有未满足或无法确认的要求");
});
