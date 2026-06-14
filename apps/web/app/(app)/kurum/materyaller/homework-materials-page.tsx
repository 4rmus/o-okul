"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialFileDownloadResult,
  HomeworkMaterialFileRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  StudentRecord,
} from "@uzman-hocam/shared-types";
import { CheckCircle2, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, authenticatedFetch, type ListMeta } from "../../../../src/api-client.js";
import {
  firstFormError,
  homeworkMaterialFormSchema,
  type HomeworkMaterialFormPayload,
  type HomeworkMaterialFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

interface HomeworkMaterialData {
  homework: HomeworkRecord[];
  homeworkMeta: ListMeta;
  materials: HomeworkMaterialRecord[];
  materialMeta: ListMeta;
  materialFiles: Record<string, HomeworkMaterialFileRecord[]>;
  materialAssignments: Record<string, HomeworkMaterialAssignmentRecord[]>;
  students: StudentRecord[];
}

const emptyMaterialForm: HomeworkMaterialFormState = {
  title: "",
  description: "",
};

const homeworkSortOptions = [
  { label: "Ödev A-Z", value: "title" },
  { label: "Teslim tarihi", value: "dueAt" },
  { label: "Kontrol tarihi", value: "-checkedAt" },
];

const materialSortOptions = [
  { label: "Materyal A-Z", value: "title" },
  { label: "Materyal Z-A", value: "-title" },
];

export function HomeworkMaterialsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [homeworkListQuery, setHomeworkListQuery] = useState<ListQueryState>(initialListQuery);
  const [materialListQuery, setMaterialListQuery] = useState<ListQueryState>(initialListQuery);
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const queryKey = ["next-homework-materials", tenantId, homeworkListQuery, materialListQuery];
  const listQueryKey = ["next-homework-materials", tenantId];
  const query = useQuery({
    queryKey,
    queryFn: () => loadHomeworkMaterialData(auth?.accessToken ?? "", homeworkListQuery, materialListQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingMaterial, setEditingMaterial] = useState<HomeworkMaterialRecord | null>(null);
  const [form, setForm] = useState<HomeworkMaterialFormState>(emptyMaterialForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [fileMaterialId, setFileMaterialId] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [fileContentType, setFileContentType] = useState<HomeworkMaterialFileRecord["contentType"]>("text/plain");
  const [downloadingFileId, setDownloadingFileId] = useState("");
  const [assignmentMaterialId, setAssignmentMaterialId] = useState("");
  const [assignmentStudentId, setAssignmentStudentId] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [error, setError] = useState("");
  const data = query.data ?? emptyHomeworkMaterialData();
  const checkedCount = data.homework.filter((record) => record.checkedAt).length;
  const studentNames = new Map(data.students.map((student) => [student.id, `${student.firstName} ${student.lastName}`]));

  useEffect(() => {
    if (!query.isSuccess) return;
    const firstMaterialId = query.data.materials[0]?.id ?? "";
    const firstStudentId = query.data.students[0]?.id ?? "";
    const visibleMaterialIds = new Set(query.data.materials.map((material) => material.id));
    setFileMaterialId((current) => (current && visibleMaterialIds.has(current) ? current : firstMaterialId));
    setAssignmentMaterialId((current) => (current && visibleMaterialIds.has(current) ? current : firstMaterialId));
    setAssignmentStudentId((current) => current || firstStudentId);
  }, [query.data, query.isSuccess]);

  const homeworkColumns: Array<DataTableColumn<HomeworkRecord>> = [
    {
      key: "title",
      header: "Ödev",
      render: (homework) => homework.title,
    },
    {
      key: "material",
      header: "Materyal",
      render: (homework) => homework.sourceMaterialTitle ?? "-",
    },
    {
      key: "status",
      header: "Durum",
      render: (homework) => homework.checkedAt ? "Kontrol edildi" : "Bekliyor",
    },
    {
      key: "actions",
      header: "İşlem",
      render: (homework) => (
        <span className="next-row-actions">
          <button
            type="button"
            onClick={() => void updateCheckStatus(homework)}
            aria-label={`${homework.title} kontrol et`}
          >
            <CheckCircle2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  const materialColumns: Array<DataTableColumn<HomeworkMaterialRecord>> = [
    {
      key: "title",
      header: "Materyal",
      render: (material) => material.title,
    },
    {
      key: "description",
      header: "Açıklama",
      render: (material) => material.description ?? "-",
    },
    {
      key: "details",
      header: "Ekler",
      render: (material) => (
        <span className="next-material-detail">
          {(data.materialFiles[material.id] ?? []).map((file) => (
            <span className="next-material-file-row" key={file.id}>
              Dosya: {file.fileName}
              <button
                type="button"
                onClick={() => void downloadMaterialFile(material.id, file)}
                disabled={downloadingFileId === file.id}
                aria-label={`${file.fileName} indir`}
              >
                <Download size={16} aria-hidden="true" />
              </button>
            </span>
          ))}
          {(data.materialAssignments[material.id] ?? []).map((assignment) => (
            <span key={assignment.id}>Atama: {studentNames.get(assignment.studentId) ?? assignment.studentId}</span>
          ))}
        </span>
      ),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (material) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(material)} aria-label={`${material.title} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void deleteMaterial(material)} aria-label={`${material.title} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingMaterial(null);
    setForm(emptyMaterialForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(material: HomeworkMaterialRecord) {
    setEditingMaterial(material);
    setForm({ title: material.title, description: material.description ?? "" });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingMaterial(null);
    setForm(emptyMaterialForm);
  }

  async function submitMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = homeworkMaterialFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedMaterial = editingMaterial
        ? await updateHomeworkMaterial(auth.accessToken, editingMaterial.id, parsedForm.data)
        : await createHomeworkMaterial(auth.accessToken, parsedForm.data);
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
      if (!editingMaterial) {
        setFileMaterialId(savedMaterial.id);
        setAssignmentMaterialId(savedMaterial.id);
      }
      closeForm();
    } catch {
      setError("Materyal kaydedilemedi.");
    }
  }

  async function deleteMaterial(material: HomeworkMaterialRecord) {
    if (!auth) return;

    setError("");
    try {
      await deleteHomeworkMaterial(auth.accessToken, material.id);
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Materyal silinemedi.");
    }
  }

  async function updateCheckStatus(homework: HomeworkRecord) {
    if (!auth) return;

    setError("");
    try {
      const savedHomework = await updateHomeworkCheckStatus(auth.accessToken, homework.id, !homework.checkedAt);
      queryClient.setQueryData<HomeworkMaterialData>(queryKey, (current = emptyHomeworkMaterialData()) => ({
        ...current,
        homework: current.homework.map((candidate) => (candidate.id === savedHomework.id ? savedHomework : candidate)),
      }));
    } catch {
      setError("Ödev kontrol durumu kaydedilemedi.");
    }
  }

  async function changeFile(file: File | undefined) {
    setError("");
    if (!file) {
      setFileName("");
      setFileBase64("");
      setFileContentType("text/plain");
      return;
    }

    try {
      setFileName(file.name);
      setFileContentType(resolveBrowserMaterialContentType(file.type));
      setFileBase64(await readFileAsBase64(file));
    } catch {
      setFileName("");
      setFileBase64("");
      setFileContentType("text/plain");
      setError("Materyal dosyası okunamadı.");
    }
  }

  async function submitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    try {
      const savedFile = await addHomeworkMaterialFile(auth.accessToken, fileMaterialId, {
        fileName,
        contentType: fileContentType,
        fileBase64,
      });
      queryClient.setQueryData<HomeworkMaterialData>(queryKey, (current = emptyHomeworkMaterialData()) => ({
        ...current,
        materialFiles: {
          ...current.materialFiles,
          [savedFile.materialId]: [savedFile, ...(current.materialFiles[savedFile.materialId] ?? [])],
        },
      }));
      setFileName("");
      setFileBase64("");
      setFileContentType("text/plain");
    } catch {
      setError("Materyal dosyası yüklenemedi.");
    }
  }

  async function downloadMaterialFile(materialId: string, file: HomeworkMaterialFileRecord) {
    if (!auth) return;

    setError("");
    setDownloadingFileId(file.id);
    try {
      downloadHomeworkMaterialFile(
        await fetchHomeworkMaterialFileDownload(auth.accessToken, materialId, file.id),
      );
    } catch (downloadError) {
      setError(apiErrorMessage(downloadError, "Materyal dosyası indirilemedi."));
    } finally {
      setDownloadingFileId("");
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    try {
      const savedAssignment = await addHomeworkMaterialAssignment(auth.accessToken, assignmentMaterialId, {
        studentId: assignmentStudentId,
        note: assignmentNote || undefined,
        dueAt: assignmentDueAt || undefined,
      });
      queryClient.setQueryData<HomeworkMaterialData>(queryKey, (current = emptyHomeworkMaterialData()) => ({
        ...current,
        materialAssignments: {
          ...current.materialAssignments,
          [savedAssignment.materialId]: [
            savedAssignment,
            ...(current.materialAssignments[savedAssignment.materialId] ?? []),
          ],
        },
      }));
      setAssignmentNote("");
      setAssignmentDueAt("");
    } catch {
      setError("Materyal ataması yapılamadı.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <ListControls
            meta={data.homeworkMeta}
            onChange={setHomeworkListQuery}
            sortOptions={homeworkSortOptions}
            state={homeworkListQuery}
          />
        }
        aria-label="Ödev kontrolü"
        columns={homeworkColumns}
        description={`${checkedCount}/${data.homework.length} ödev kontrol edildi`}
        emptyState={
          <EmptyState
            title="Ödev kaydı yok"
            description="Ödevler oluştuğunda kontrol listesi burada görünür."
            hint="Bu alan öğretmen ve materyal akışından gelen ödevleri izlemek için kullanılır."
          />
        }
        emptyText="Ödev kaydı yok"
        error={query.isError ? "Ödev verisi alınamadı." : undefined}
        getRowKey={(homework) => homework.id}
        loading={query.isPending}
        rows={data.homework}
        title="Ödev Kontrolü"
      />
      <CrudPage
        actions={
          <>
            <ListControls
              meta={data.materialMeta}
              onChange={setMaterialListQuery}
              sortOptions={materialSortOptions}
              state={materialListQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Materyal ekle
            </Button>
          </>
        }
        aria-label="Materyal listesi"
        columns={materialColumns}
        description="Materyal havuzu, dosyalar ve öğrenci atamaları."
        emptyState={
          <EmptyState
            title="Materyal havuzu boş"
            description="İlk materyali ekleyerek dosya ve öğrenci atama akışını başlat."
            hint="Materyal eklendikten sonra dosya yükleyebilir ve öğrencilere atayabilirsin."
            primaryAction={{ label: "Materyal ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Materyal yok"
        error={error || undefined}
        getRowKey={(material) => material.id}
        loading={query.isPending}
        rows={data.materials}
        title="Materyal Havuzu"
      />
      <section className="next-support-tools" aria-label="Materyal araçları">
        <form className="next-support-tool" onSubmit={(event) => void submitFile(event)}>
          <h2>Dosya</h2>
          <label>
            Materyal
            <select value={fileMaterialId} onChange={(event) => setFileMaterialId(event.target.value)} required>
              {data.materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Materyal dosyası
            <Input type="file" onChange={(event) => void changeFile(event.target.files?.[0])} />
          </label>
          <Button disabled={!fileMaterialId || !fileBase64} type="submit">
            <Upload size={17} aria-hidden="true" />
            Dosya yükle
          </Button>
          {fileName ? <p>{fileName}</p> : null}
        </form>
        <form className="next-support-tool" onSubmit={(event) => void submitAssignment(event)}>
          <h2>Atama</h2>
          <label>
            Materyal
            <select
              value={assignmentMaterialId}
              onChange={(event) => setAssignmentMaterialId(event.target.value)}
              required
            >
              {data.materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Öğrenci
            <select value={assignmentStudentId} onChange={(event) => setAssignmentStudentId(event.target.value)} required>
              {data.students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.firstName} {student.lastName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Not
            <Input value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} />
          </label>
          <label>
            Teslim
            <Input type="date" value={assignmentDueAt} onChange={(event) => setAssignmentDueAt(event.target.value)} />
          </label>
          <Button disabled={!assignmentMaterialId || !assignmentStudentId} type="submit">
            <Plus size={17} aria-hidden="true" />
            Öğrenciye ata
          </Button>
        </form>
      </section>
      <FormModal
        description="Materyal adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void submitMaterial(event)}
        open={isFormOpen}
        submitLabel={editingMaterial ? "Kaydet" : "Ekle"}
        title={editingMaterial ? "Materyal düzenle" : "Materyal ekle"}
      >
        <label>
          Materyal adı
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label>
          Açıklama
          <Input
            value={form.description ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          />
        </label>
      </FormModal>
    </>
  );
}

function emptyHomeworkMaterialData(): HomeworkMaterialData {
  return {
    homework: [],
    homeworkMeta: { total: 0, page: 1, limit: initialListQuery.limit, totalPages: 0 },
    materials: [],
    materialMeta: { total: 0, page: 1, limit: initialListQuery.limit, totalPages: 0 },
    materialFiles: {},
    materialAssignments: {},
    students: [],
  };
}

async function loadHomeworkMaterialData(
  accessToken: string,
  homeworkListQuery: ListQueryState,
  materialListQuery: ListQueryState,
): Promise<HomeworkMaterialData> {
  const [homeworkResult, materialResult, students] = await Promise.all([
    apiListRequest<HomeworkRecord>(accessToken, buildListUrl(`${apiBaseUrl}/homework`, homeworkListQuery)),
    apiListRequest<HomeworkMaterialRecord>(accessToken, buildListUrl(`${apiBaseUrl}/homework/materials`, materialListQuery)),
    apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`),
  ]);
  const materials = materialResult.data;
  const [materialFiles, materialAssignments] = await Promise.all([
    loadHomeworkMaterialFileMap(accessToken, materials),
    loadHomeworkMaterialAssignmentMap(accessToken, materials),
  ]);

  return {
    homework: homeworkResult.data,
    homeworkMeta: homeworkResult.meta,
    materials,
    materialMeta: materialResult.meta,
    materialFiles,
    materialAssignments,
    students,
  };
}

async function createHomeworkMaterial(accessToken: string, input: HomeworkMaterialFormPayload) {
  return apiRequest<HomeworkMaterialRecord>(accessToken, `${apiBaseUrl}/homework/materials`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateHomeworkMaterial(accessToken: string, id: string, input: HomeworkMaterialFormPayload) {
  return apiRequest<HomeworkMaterialRecord>(accessToken, `${apiBaseUrl}/homework/materials/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteHomeworkMaterial(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/homework/materials/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("HOMEWORK_MATERIAL_DELETE_FAILED");
  }
}

async function loadHomeworkMaterialFileMap(accessToken: string, materials: HomeworkMaterialRecord[]) {
  const entries = await Promise.all(
    materials.map(async (material) => [
      material.id,
      await apiRequest<HomeworkMaterialFileRecord[]>(
        accessToken,
        `${apiBaseUrl}/homework/materials/${encodeURIComponent(material.id)}/files`,
      ),
    ] as const),
  );
  return Object.fromEntries(entries);
}

async function loadHomeworkMaterialAssignmentMap(accessToken: string, materials: HomeworkMaterialRecord[]) {
  const entries = await Promise.all(
    materials.map(async (material) => [
      material.id,
      await apiRequest<HomeworkMaterialAssignmentRecord[]>(
        accessToken,
        `${apiBaseUrl}/homework/materials/${encodeURIComponent(material.id)}/assignments`,
      ),
    ] as const),
  );
  return Object.fromEntries(entries);
}

async function addHomeworkMaterialFile(
  accessToken: string,
  materialId: string,
  input: Pick<HomeworkMaterialFileRecord, "fileName" | "contentType"> & { fileBase64: string },
) {
  return apiRequest<HomeworkMaterialFileRecord>(
    accessToken,
    `${apiBaseUrl}/homework/materials/${encodeURIComponent(materialId)}/files`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function fetchHomeworkMaterialFileDownload(accessToken: string, materialId: string, fileId: string) {
  return apiRequest<HomeworkMaterialFileDownloadResult>(
    accessToken,
    `${apiBaseUrl}/homework/materials/${encodeURIComponent(materialId)}/files/${encodeURIComponent(fileId)}/download`,
  );
}

async function addHomeworkMaterialAssignment(
  accessToken: string,
  materialId: string,
  input: Pick<HomeworkMaterialAssignmentRecord, "studentId"> &
    Pick<Partial<HomeworkMaterialAssignmentRecord>, "note" | "dueAt">,
) {
  return apiRequest<HomeworkMaterialAssignmentRecord>(
    accessToken,
    `${apiBaseUrl}/homework/materials/${encodeURIComponent(materialId)}/assignments`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function updateHomeworkCheckStatus(accessToken: string, id: string, checked: boolean) {
  return apiRequest<HomeworkRecord>(accessToken, `${apiBaseUrl}/homework/${encodeURIComponent(id)}/check-status`, {
    body: JSON.stringify({ checked }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

function resolveBrowserMaterialContentType(value: string): HomeworkMaterialFileRecord["contentType"] {
  if (value === "application/pdf" || value === "image/jpeg" || value === "image/png") {
    return value;
  }
  return "text/plain";
}

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function downloadHomeworkMaterialFile(file: HomeworkMaterialFileDownloadResult): void {
  if (file.downloadUrl) {
    const link = document.createElement("a");
    link.href = file.downloadUrl;
    link.download = file.fileName;
    link.click();
    return;
  }

  if (!file.fileBase64) {
    throw new Error("HOMEWORK_MATERIAL_FILE_DOWNLOAD_EMPTY");
  }

  const binary = atob(file.fileBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}
