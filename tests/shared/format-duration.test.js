import test from "node:test";
import assert from "node:assert/strict";

import { formatDuration } from "../../src/shared/format-duration.js";

test("运行时长按小时格式显示", () => {
  assert.equal(formatDuration(3661), "01:01:01");
});
