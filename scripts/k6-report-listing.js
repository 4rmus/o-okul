import http from "k6/http";
import { check, fail, sleep } from "k6";

const apiBaseUrl = (__ENV.API_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const token = __ENV.API_TOKEN;
const examId = __ENV.EXAM_ID;
const studentId = __ENV.STUDENT_ID;
const expectedResultCount = Number(__ENV.EXPECTED_RESULT_COUNT || "10000");

export const options = {
  scenarios: {
    report_listing_10k: {
      executor: "constant-vus",
      vus: Number(__ENV.K6_VUS || "10"),
      duration: __ENV.K6_DURATION || "30s",
    },
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:snapshots}": ["p(95)<1500"],
    "http_req_duration{endpoint:student_progress}": ["p(95)<1200"],
  },
};

export function setup() {
  if (!token) fail("API_TOKEN is required");
  if (!examId) fail("EXAM_ID is required");
  if (!Number.isFinite(expectedResultCount) || expectedResultCount < 10000) {
    fail("EXPECTED_RESULT_COUNT must be at least 10000");
  }

  return {
    headers: {
      authorization: `Bearer ${token}`,
    },
  };
}

export default function (data) {
  const snapshotResponse = http.get(
    `${apiBaseUrl}/api/v1/exams/${encodeURIComponent(examId)}/reports/snapshots`,
    {
      headers: data.headers,
      tags: { endpoint: "snapshots" },
    },
  );

  const snapshotOk = check(snapshotResponse, {
    "snapshot list status is 200": (response) => response.status === 200,
    "snapshot list includes 10k students": (response) => {
      const snapshots = readData(response);
      const firstSnapshot = Array.isArray(snapshots) ? snapshots[0] : undefined;
      const resultCount = firstSnapshot?.snapshotData?.resultCount;
      const studentCount = firstSnapshot?.snapshotData?.students?.length;
      return resultCount >= expectedResultCount && studentCount >= expectedResultCount;
    },
  });

  if (!snapshotOk) return;

  const resolvedStudentId = studentId || readData(snapshotResponse)?.[0]?.snapshotData?.students?.[0]?.studentId;
  if (resolvedStudentId) {
    const progressResponse = http.get(
      `${apiBaseUrl}/api/v1/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(resolvedStudentId)}/progress`,
      {
        headers: data.headers,
        tags: { endpoint: "student_progress" },
      },
    );

    check(progressResponse, {
      "student progress status is 200": (response) => response.status === 200,
      "student progress returns points": (response) => {
        const progress = readData(response);
        return Array.isArray(progress?.points) && progress.points.length > 0;
      },
    });
  }

  sleep(1);
}

function readData(response) {
  try {
    return response.json("data");
  } catch {
    return undefined;
  }
}
