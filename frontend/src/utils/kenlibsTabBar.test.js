// Run with `npm test` (Node's built-in test runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeTab, showsTabBar } from "./kenlibsTabBar.js";

test("the tab bar shows on storefront and account pages only", () => {
  for (const path of [
    "/kenlibs",
    "/kenlibs/",
    "/kenlibs/book/64b000000000000000000001",
    "/kenlibs/bundle/64b000000000000000000002",
    "/kenlibs/my-books",
    "/kenlibs/referrals",
    "/kenlibs/profile",
    "/kenlibs/support",
    "/kenlibs/terms",
    "/kenlibs/privacy",
    "/kenlibs/refund-policy",
  ]) {
    assert.equal(showsTabBar(path), true, path);
  }
  for (const path of [
    "/kenlibs/read/64b000000000000000000001",
    "/read/AbCdEf123456",
    "/kenlibs/checkout/book/64b000000000000000000001",
    "/kenlibs/login",
    "/kenlibs/signup",
    "/kenlibs/forgot-password",
    "/kenlibs/reset-password/abc",
    "/login",
    "/dashboard",
    "/admin/analytics",
    "/profile",
    "/editor/64b000000000000000000001",
    "/kenlibs/book/1/extra",
  ]) {
    assert.equal(showsTabBar(path), false, path);
  }
});

test("the active tab", () => {
  assert.equal(activeTab("/kenlibs"), "home");
  assert.equal(activeTab("/kenlibs/book/abc"), "home");
  assert.equal(activeTab("/kenlibs/bundle/abc"), "home");
  assert.equal(activeTab("/kenlibs/my-books"), "library");
  assert.equal(activeTab("/kenlibs/profile"), "profile");
  assert.equal(activeTab("/kenlibs/referrals"), "profile");
  assert.equal(activeTab("/kenlibs/terms"), null);
});
