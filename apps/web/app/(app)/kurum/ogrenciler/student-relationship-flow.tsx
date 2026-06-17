"use client";

import type { ReactNode } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";

export interface StudentRelationshipFlowItem {
  detail: string;
  id: string;
  label: string;
}

export interface StudentRelationshipFlowData {
  classNode: StudentRelationshipFlowItem;
  guardians: StudentRelationshipFlowItem[];
  student: StudentRelationshipFlowItem;
  teachers: StudentRelationshipFlowItem[];
}

interface RelationshipNodeData extends Record<string, unknown> {
  label: ReactNode;
}

export default function StudentRelationshipFlow({ data }: { data: StudentRelationshipFlowData }) {
  const nodes = buildNodes(data);
  const edges = buildEdges(data);

  return (
    <div
      className="next-student-relationship-flow"
      data-edge-count={edges.length}
      data-node-count={nodes.length}
    >
      <ReactFlow
        edges={edges}
        fitView
        maxZoom={1.35}
        minZoom={0.55}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function buildNodes(data: StudentRelationshipFlowData): Array<Node<RelationshipNodeData>> {
  const guardianNodes = data.guardians.map((guardian, index) => createNode(
    `guardian:${guardian.id}`,
    guardian,
    { x: 20, y: 110 + index * 106 },
    "guardian",
  ));
  const teacherNodes = data.teachers.map((teacher, index) => createNode(
    `teacher:${teacher.id}`,
    teacher,
    { x: 660, y: 110 + index * 106 },
    "teacher",
  ));

  return [
    createNode("class", data.classNode, { x: 340, y: 0 }, "class"),
    createNode("student", data.student, { x: 340, y: 168 }, "student"),
    ...guardianNodes,
    ...teacherNodes,
  ];
}

function buildEdges(data: StudentRelationshipFlowData): Edge[] {
  return [
    createEdge("class", "student", "edge:class-student"),
    ...data.guardians.map((guardian) => createEdge(`guardian:${guardian.id}`, "student", `edge:guardian:${guardian.id}`)),
    ...data.teachers.map((teacher) => createEdge(`teacher:${teacher.id}`, "student", `edge:teacher:${teacher.id}`)),
  ];
}

function createNode(
  id: string,
  item: StudentRelationshipFlowItem,
  position: { x: number; y: number },
  tone: "class" | "guardian" | "student" | "teacher",
): Node<RelationshipNodeData> {
  return {
    id,
    className: `next-student-flow-node next-student-flow-node--${tone}`,
    data: {
      label: (
        <div>
          <strong>{item.label}</strong>
          <span>{item.detail}</span>
        </div>
      ),
    },
    position,
    type: "default",
  };
}

function createEdge(source: string, target: string, id: string): Edge {
  return {
    id,
    markerEnd: { type: MarkerType.ArrowClosed },
    source,
    target,
    type: "smoothstep",
  };
}
