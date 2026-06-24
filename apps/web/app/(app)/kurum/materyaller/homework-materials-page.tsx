"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  InfoGrid,
  InfoItem,
  Input,
  Panel,
  Select,
  StatusBadge,
  Textarea,
  Tooltip,
  type DataTableColumn,
  type StatusBadgeProps,
  useConfirmDialog,
} from "@o-okul/ui";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialFileDownloadResult,
  HomeworkMaterialFileRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  StudentRecord,
} from "@o-okul/shared-types";
import { CheckCircle2, Download, Eye, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, authenticatedFetch, type ListMeta } from "../../../../src/api-client.js";
import {
  firstFormError,
  homeworkMaterialFormSchema,
  type HomeworkMaterialFormPayload,
  type HomeworkMaterialFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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
  const { confirm, confirmationDialog } = useConfirmDialog();
  const searchParams = useSearchParams();
  const [homeworkListQuery, setHomeworkListQuery] = useUrlListState(searchParams, {
    namespace: "homework",
    sortOptions: homeworkSortOptions,
  });
  const [materialListQuery, setMaterialListQuery] = useUrlListState(searchParams, {
    namespace: "materials",
    sortOptions: materialSortOptions,
  });
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
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [fileContentType, setFileContentType] = useState<HomeworkMaterialFileRecord["contentType"]>("text/plain");
  const [downloadingFileId, setDownloadingFileId] = useState("");
  const [assignmentStudentId, setAssignmentStudentId] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [error, setError] = useState("");
  const data = query.data ?? emptyHomeworkMaterialData();
  const checkedCount = data.homework.filter((record) => record.checkedAt).length;
  const pendingHomeworkCount = Math.max(data.homework.length - checkedCount, 0);
  const materialFileCount = Object.values(data.materialFiles).reduce((total, files) => total + files.length, 0);
  const materialAssignmentCount = Object.values(data.materialAssignments).reduce((total, assignments) => total + assignments.length, 0);
  const fileBackedMaterialCount = Object.values(data.materialFiles).filter((files) => files.length > 0).length;
  const assignedMaterialCount = Object.values(data.materialAssignments).filter((assignments) => assignments.length > 0).length;
  const studentNames = new Map(data.students.map((student) => [student.id, `${student.firstName} ${student.lastName}`]));
  const selectedMaterial = data.materials.find((material) => material.id === selectedMaterialId);
  const selectedMaterialFiles = selectedMaterial ? (data.materialFiles[selectedMaterial.id] ?? []) : [];
  const selectedMaterialAssignments = selectedMaterial ? (data.materialAssignments[selectedMaterial.id] ?? []) : [];
  const materialSummaryItems: OperationSummaryItem[] = [
    {
      description: "Kontrol aksiyonu bekleyen ödev",
      key: "pending-homework",
      label: "Kontrol bekleyen",
      tone: pendingHomeworkCount > 0 ? "warning" : "success",
      value: formatCount(pendingHomeworkCount),
    },
    {
      description: "Bu sayfada tamamlanan kontrol",
      key: "checked-homework",
      label: "Kontrol edilen",
      tone: checkedCount > 0 ? "success" : "default",
      value: `${formatCount(checkedCount)}/${formatCount(data.homework.length)}`,
    },
    {
      description: "Materyal havuzu toplamı",
      key: "materials",
      label: "Materyal",
      value: formatCount(data.materials.length),
    },
    {
      description: "Öğrenciye atanmış materyal",
      key: "assigned-materials",
      label: "Atanmış materyal",
      tone: assignedMaterialCount > 0 ? "info" : "warning",
      value: `${formatCount(assignedMaterialCount)}/${formatCount(data.materials.length)}`,
    },
  ];
  const materialSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "files",
      label: `${formatCount(fileBackedMaterialCount)} dosyalı materyal`,
      tone: fileBackedMaterialCount > 0 ? "success" : "neutral",
    },
    {
      key: "assignments",
      label: `${formatCount(materialAssignmentCount)} öğrenci ataması`,
      tone: materialAssignmentCount > 0 ? "info" : "neutral",
    },
  ];
  const materialSummaryActions: OperationSummaryAction[] = [
    {
      detail: selectedMaterial ? selectedMaterial.title : "Listeden materyal seç",
      key: "selected-material",
      label: "Materyal detayı",
      status: selectedMaterial ? "Seçili" : "Bekliyor",
      tone: selectedMaterial ? "info" : "neutral",
      value: selectedMaterial ? `${formatCount(selectedMaterialFiles.length)} dosya` : "Seçilmedi",
    },
    {
      detail: selectedMaterialFiles.length > 0 ? "Dosya indir/yükle akışı açık" : "Dosya yükleme bekliyor",
      key: "files",
      label: "Dosya akışı",
      status: selectedMaterialFiles.length > 0 ? "Hazır" : "Bekliyor",
      tone: selectedMaterialFiles.length > 0 ? "success" : "neutral",
      value: `${formatCount(materialFileCount)} dosya`,
    },
    {
      detail: selectedMaterialAssignments.length > 0 ? "Öğrenciye atanmış materyal var" : "Atama formu hazır",
      key: "assignments",
      label: "Atama akışı",
      status: selectedMaterialAssignments.length > 0 ? "Atanmış" : "Hazır",
      tone: selectedMaterialAssignments.length > 0 ? "info" : "warning",
      value: `${formatCount(materialAssignmentCount)} atama`,
    },
  ];

  useEffect(() => {
    if (!query.isSuccess) return;
    const firstMaterialId = query.data.materials[0]?.id ?? "";
    const firstStudentId = query.data.students[0]?.id ?? "";
    const visibleMaterialIds = new Set(query.data.materials.map((material) => material.id));
    setSelectedMaterialId((current) => (current && visibleMaterialIds.has(current) ? current : firstMaterialId));
    setAssignmentStudentId((current) => current || firstStudentId);
  }, [query.data, query.isSuccess]);

  const homeworkColumns: Array<DataTableColumn<HomeworkRecord>> = [
    {
      key: "title",
      header: "Ödev",
      mobilePriority: "primary",
      priority: "primary",
      render: (homework) => homework.title,
      sticky: "left",
    },
    {
      key: "material",
      header: "Materyal",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (homework) => homework.sourceMaterialTitle ?? "-",
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "primary",
      priority: "primary",
      render: (homework) => (
        <StatusBadge tone={homeworkStatusTone(homework)}>
          {homework.checkedAt ? "Kontrol edildi" : "Bekliyor"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
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
      sticky: "right",
    },
  ];

  const materialColumns: Array<DataTableColumn<HomeworkMaterialRecord>> = [
    {
      key: "title",
      header: "Materyal",
      mobilePriority: "primary",
      priority: "primary",
      render: (material) => material.title,
      sticky: "left",
    },
    {
      key: "description",
      header: "Açıklama",
      mobilePriority: "hidden",
      priority: "optional",
      render: (material) => material.description ?? "-",
    },
    {
      key: "details",
      header: "Ekler",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (material) => {
        const fileCount = data.materialFiles[material.id]?.length ?? 0;
        const assignmentCount = data.materialAssignments[material.id]?.length ?? 0;
        return (
          <span className="next-material-detail">
            <span>{formatCount(fileCount)} dosya</span>
            <span>{formatCount(assignmentCount)} öğrenci ataması</span>
          </span>
        );
      },
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      render: (material) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => selectMaterial(material.id)} aria-label={`${material.title} detayını aç`}>
            <Eye size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => openEditForm(material)} aria-label={`${material.title} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void deleteMaterial(material)} aria-label={`${material.title} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
      sticky: "right",
    },
  ];

  function openCreateForm() {
    setEditingMaterial(null);
    setForm(emptyMaterialForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(material: HomeworkMaterialRecord) {
    selectMaterial(material.id);
    setEditingMaterial(material);
    setForm({ title: material.title, description: material.description ?? "" });
    setError("");
    setIsFormOpen(true);
  }

  function selectMaterial(materialId: string) {
    setSelectedMaterialId(materialId);
    setError("");
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
        selectMaterial(savedMaterial.id);
      }
      closeForm();
    } catch {
      setError("Materyal kaydedilemedi.");
    }
  }

  async function deleteMaterial(material: HomeworkMaterialRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${material.title} materyali, dosya ve atama bağlantılarıyla silinsin mi?`,
      title: "Materyali sil",
    });
    if (!confirmed) return;

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
      const savedFile = await addHomeworkMaterialFile(auth.accessToken, selectedMaterialId, {
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
      const savedAssignment = await addHomeworkMaterialAssignment(auth.accessToken, selectedMaterialId, {
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
        density="compact"
        loading={query.isPending}
        rows={data.homework}
        summary={
          <OperationSummary
            actions={materialSummaryActions}
            ariaLabel="Materyal operasyon özeti"
            badges={materialSummaryBadges}
            items={materialSummaryItems}
          />
        }
        tableCaption="Ödev kontrol akışı"
        tableDescription="Ödev adı, materyal bağlantısı, kontrol durumu ve hızlı kontrol aksiyonu."
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
        density="compact"
        loading={query.isPending}
        rowClassName={(material) => (material.id === selectedMaterialId ? "next-material-row--selected" : undefined)}
        rows={data.materials}
        tableCaption="Materyal havuzu"
        tableDescription="Materyal açıklaması, dosya ekleri, öğrenci atamaları ve havuz aksiyonları."
        title="Materyal Havuzu"
      />
      <section className="next-material-detail-grid" aria-label="Materyal araçları">
        <Panel
          aria-label="Materyal seçili detay"
          className="next-material-selected-panel"
          description="Seçili materyalin dosya, atama ve geçmiş akışı."
          title="Seçili Materyal"
        >
          <Field label="Materyal">
            <Select value={selectedMaterialId} onChange={(event) => selectMaterial(event.target.value)} required>
              {data.materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.title}
                </option>
              ))}
            </Select>
          </Field>
          {selectedMaterial ? (
            <div className="next-material-selected-context">
              <h2>{selectedMaterial.title}</h2>
              <div className="next-material-selected-badges" aria-label="Seçili materyal durumu">
                <StatusBadge tone={selectedMaterialFiles.length > 0 ? "success" : "neutral"}>
                  {selectedMaterialFiles.length > 0 ? "Dosyalı" : "Dosya yok"}
                </StatusBadge>
                <StatusBadge tone={selectedMaterialAssignments.length > 0 ? "info" : "warning"}>
                  {selectedMaterialAssignments.length > 0 ? "Atanmış" : "Atama bekliyor"}
                </StatusBadge>
              </div>
              <InfoGrid className="next-material-selected-meta" aria-label="Seçili materyal metrikleri" role="region">
                <InfoItem label="Açıklama" value={selectedMaterial.description || "Açıklama yok"} />
                <InfoItem label="Dosya" value={`${formatCount(selectedMaterialFiles.length)} dosya`} />
                <InfoItem label="Atama" value={`${formatCount(selectedMaterialAssignments.length)} öğrenci`} />
              </InfoGrid>
            </div>
          ) : (
            <p>Dosya ve atama işlemi için listeden bir materyal seç.</p>
          )}
          <div className="next-material-actions">
            <form className="next-material-form" onSubmit={(event) => void submitFile(event)}>
              <h3>Dosya</h3>
              <Field label="Materyal dosyası">
                <Input type="file" onChange={(event) => void changeFile(event.target.files?.[0])} />
              </Field>
              <Button disabled={!selectedMaterialId || !fileBase64} type="submit">
                <Upload size={17} aria-hidden="true" />
                Dosya yükle
              </Button>
              {fileName ? <p>{fileName}</p> : null}
            </form>
            <form className="next-material-form" onSubmit={(event) => void submitAssignment(event)}>
              <h3>Atama</h3>
              <Field label="Öğrenci">
                <Select value={assignmentStudentId} onChange={(event) => setAssignmentStudentId(event.target.value)} required>
                  {data.students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.firstName} {student.lastName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Not" description="Atama notu olarak iletilecek kısa materyal yönergesi.">
                <Textarea rows={3} value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} />
              </Field>
              <Field label="Teslim">
                <Input type="date" value={assignmentDueAt} onChange={(event) => setAssignmentDueAt(event.target.value)} />
              </Field>
              <Button disabled={!selectedMaterialId || !assignmentStudentId} type="submit">
                <Plus size={17} aria-hidden="true" />
                Öğrenciye ata
              </Button>
            </form>
          </div>
          <section className="next-material-activity" aria-label="Materyal dosya ve atama listesi">
            {selectedMaterial ? (
              <article>
                <h3>{selectedMaterial.title}</h3>
                <section aria-label="Seçili materyal dosyaları">
                  <h4>Dosyalar</h4>
                  {selectedMaterialFiles.length > 0 ? (
                    selectedMaterialFiles.map((file) => (
                      <p key={file.id} className="next-material-file-row">
                        <span>Dosya: {file.fileName}</span>
                        <Tooltip label={`${file.fileName} indir`}>
                          <Button
                            aria-label={`${file.fileName} indir`}
                            disabled={downloadingFileId === file.id}
                            onClick={() => void downloadMaterialFile(selectedMaterial.id, file)}
                            size="icon"
                            type="button"
                            variant="secondary"
                          >
                            <Download size={16} aria-hidden="true" />
                          </Button>
                        </Tooltip>
                      </p>
                    ))
                  ) : (
                    <p>Dosya yok</p>
                  )}
                </section>
                <section aria-label="Seçili materyal atamaları">
                  <h4>Atamalar</h4>
                  {selectedMaterialAssignments.length > 0 ? (
                    selectedMaterialAssignments.map((assignment) => (
                      <p key={assignment.id}>Atama: {studentNames.get(assignment.studentId) ?? "Öğrenci kapsamı doğrulanmadı"}</p>
                    ))
                  ) : (
                    <p>Atama yok</p>
                  )}
                </section>
              </article>
            ) : (
              <article>
                <h3>Seçili materyal yok</h3>
                <p>Dosya ve atama geçmişi için listeden bir materyal seç.</p>
              </article>
            )}
          </section>
        </Panel>
      </section>
      <FormModal
        description="Materyal adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void submitMaterial(event)}
        open={isFormOpen}
        submitLabel={editingMaterial ? "Kaydet" : "Ekle"}
        title={editingMaterial ? "Materyal düzenle" : "Materyal ekle"}
      >
        <Field label="Materyal adı">
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Açıklama" description="Öğretmen ve öğrenci listelerinde görünecek kısa materyal bağlamı.">
          <Textarea
            rows={4}
            value={form.description ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          />
        </Field>
      </FormModal>
      {confirmationDialog}
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

function homeworkStatusTone(homework: HomeworkRecord): StatusBadgeProps["tone"] {
  return homework.checkedAt ? "success" : "warning";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
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
