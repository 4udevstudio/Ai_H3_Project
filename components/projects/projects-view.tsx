'use client'

/**
 * ========================================
 * ProjectsView
 * ========================================
 * Description:
 * UI สำหรับจัดการโปรเจคเบื้องต้น
 *
 * Features:
 * - สร้างโปรเจคใหม่
 * - แสดงรายการโปรเจค
 * - แก้ชื่อ/คำอธิบายโปรเจค
 * - ลบโปรเจคพร้อมกล่องยืนยันแบบ custom modal
 * - แสดงจำนวน generation ในโปรเจค
 * - ชื่อโปรเจคเป็นลิงก์ไปหน้า detail /projects/[id]
 * - ปุ่ม "ดูงาน" ไปหน้า detail /projects/[id]
 * - รองรับทุกธีมผ่าน shadcn/Tailwind tokens
 *
 * Notes:
 * - การย้าย history เข้า project ทำที่หน้า History
 * - หน้า detail project ดูได้ใน /projects/[id]
 */

import * as React from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  Eye,
  FolderOpen,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * โครงสร้างข้อมูลโปรเจคที่ API คืนค่า
 */
interface ProjectItem {
  id: string
  name: string
  description: string | null
  theme: string
  createdAt: string
  updatedAt: string
  _count: {
    generations: number
  }
}

/**
 * แปลง ISO date string เป็นข้อความวันทีอ่านง่าย
 *
 * @param isoDate ISO string
 */
function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString()
  } catch {
    return '-'
  }
}

/**
 * คอมโพเนนต์หลักของหน้า Projects
 */
export function ProjectsView() {
  const [projects, setProjects] = React.useState<ProjectItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [newName, setNewName] = React.useState('')
  const [newDescription, setNewDescription] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')
  const [editDescription, setEditDescription] = React.useState('')
  const [savingEdit, setSavingEdit] = React.useState(false)

  const [deletingProject, setDeletingProject] = React.useState<ProjectItem | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  /**
   * ดึงรายการโปรเจคจาก API
   *
   * @param showSpinner แสดง loader ตอน refresh manual หรือไม่
   */
  const loadProjects = React.useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)

    try {
      const response = await fetch('/api/projects', {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = (await response.json()) as ProjectItem[]
      setProjects(data)
      setError(null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'ดึงรายการโปรเจคไม่สำเร็จ'
      setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  /**
   * โหลดโปรเจคครั้งแรกตอน mount
   */
  React.useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  /**
   * สร้างโปรเจคใหม่
   *
   * @param event submit event ของฟอร์ม
   */
  const handleCreateProject = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    setError(null)

    const trimmedName = newName.trim()

    if (!trimmedName) {
      toast.error('กรุณากรอกชื่อโปรเจค')
      return
    }

    setCreating(true)

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          description: newDescription.trim() || null,
        }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `HTTP ${response.status}`)
      }

      setNewName('')
      setNewDescription('')
      toast.success('สร้างโปรเจคเรียบร้อย')
      await loadProjects()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'สร้างโปรเจคไม่สำเร็จ'
      toast.error(message)
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  /**
   * เริ่มโหมดแก้ไขโปรเจค
   *
   * @param project โปรเจคที่ต้องการแก้
   */
  const startEditing = (project: ProjectItem) => {
    setEditingId(project.id)
    setEditName(project.name)
    setEditDescription(project.description ?? '')
  }

  /**
   * ยกเลิกโหมดแก้ไข
   */
  const cancelEditing = () => {
    setEditingId(null)
    setEditName('')
    setEditDescription('')
  }

  /**
   * บันทึกการแก้ไขโปรเจค
   *
   * @param projectId id ของโปรเจค
   */
  const saveProjectEdit = async (projectId: string) => {
    const trimmedName = editName.trim()

    if (!trimmedName) {
      toast.error('ชื่อโปรเจคห้ามว่างเปล่า')
      return
    }

    setSavingEdit(true)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          description: editDescription.trim() || null,
        }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `HTTP ${response.status}`)
      }

      toast.success('แก้ไขโปรเจคเรียบร้อย')
      cancelEditing()
      await loadProjects()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'แก้ไขโปรเจคไม่สำเร็จ'
      toast.error(message)
    } finally {
      setSavingEdit(false)
    }
  }

  /**
   * เปิดกล่องยืนยันก่อนลบโปรเจค
   *
   * @param project โปรเจคที่ต้องการลบ
   */
  const askDeleteProject = (project: ProjectItem) => {
    setDeletingProject(project)
  }

  /**
   * ปิดกล่องยืนยันลบโปรเจค
   */
  const closeDeleteDialog = () => {
    if (!deleting) {
      setDeletingProject(null)
    }
  }

  /**
   * ยืนยันลบโปรเจค
   */
  const confirmDeleteProject = async () => {
    if (!deletingProject) return

    setDeleting(true)

    try {
      const response = await fetch(`/api/projects/${deletingProject.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `HTTP ${response.status}`)
      }

      toast.success('ลบโปรเจคเรียบร้อย')
      setDeletingProject(null)
      await loadProjects()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'ลบโปรเจคไม่สำเร็จ'
      toast.error(message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="grid gap-6">
      {/* ========================================
          การ์ดสร้างโปรเจคใหม่
          ======================================== */}
      <Card className="shadow-lg">
        <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-3 text-xl">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FolderOpen className="h-5 w-5" />
              </span>
              จัดการโปรเจค
            </CardTitle>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadProjects(true)}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              รีเฟรช
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            สร้างโปรเจคเพื่อจัดกลุ่มวิดีโอ/งาน generation ในขั้นตอนถัดไป
          </p>
        </CardHeader>

        <CardContent className="p-5">
          <form onSubmit={handleCreateProject} className="grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="project-name" className="text-sm font-medium">
                ชื่อโปรเจค
              </label>
              <Input
                id="project-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="ตัวอย่าง: โฆษณาสินค้าเดือนพฤศจิกายน"
                maxLength={120}
              />
            </div>

            <div className="grid gap-2">
              <label
                htmlFor="project-description"
                className="text-sm font-medium"
              >
                คำอธิบาย (ไม่บังคับ)
              </label>
              <Textarea
                id="project-description"
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="บันทึกหมายเหตุ เช่น ลูกค้า, สไตล์, หรือเป้าหมายของงานชุดนี้"
                className="min-h-24 resize-y"
                maxLength={1000}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={creating} className="shadow-md">
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังสร้าง
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    สร้างโปรเจค
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ========================================
          รายการโปรเจค
          ======================================== */}
      <Card className="shadow-lg">
        <CardHeader className="border-b border-border bg-card/60 backdrop-blur">
          <CardTitle className="text-xl">รายการโปรเจค</CardTitle>
          <p className="text-sm text-muted-foreground">
            ทั้งหมด {projects.length} โปรเจค
          </p>
        </CardHeader>

        <CardContent className="p-5">
          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">กำลังโหลดรายการโปรเจค...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
              <FolderOpen className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                ยังไม่มีโปรเจค
              </p>
              <p className="text-xs text-muted-foreground">
                สร้างโปรเจคแรกจากฟอร์มด้านบนเพื่อเริ่มจัดกลุ่มงาน
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => {
                const isEditing = editingId === project.id

                return (
                  <motion.div
                    key={project.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-xl border border-border bg-muted/20 p-4 shadow-sm transition-shadow hover:shadow-md"
                  >
                    {isEditing ? (
                      <div className="grid gap-3">
                        <div className="grid gap-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            ชื่อโปรเจค
                          </label>
                          <Input
                            value={editName}
                            onChange={(event) =>
                              setEditName(event.target.value)
                            }
                            maxLength={120}
                          />
                        </div>

                        <div className="grid gap-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            คำอธิบาย
                          </label>
                          <Textarea
                            value={editDescription}
                            onChange={(event) =>
                              setEditDescription(event.target.value)
                            }
                            className="min-h-20 resize-y"
                            maxLength={1000}
                          />
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={cancelEditing}
                            disabled={savingEdit}
                          >
                            <X className="mr-2 h-4 w-4" />
                            ยกเลิก
                          </Button>

                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void saveProjectEdit(project.id)}
                            disabled={savingEdit}
                          >
                            {savingEdit ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="mr-2 h-4 w-4" />
                            )}
                            บันทึก
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {/* ชื่อโปรเจคเป็นลิงก์ไปหน้า detail */}
                            <Link
                              href={`/projects/${project.id}`}
                              className="block truncate text-base font-semibold text-foreground transition-colors hover:text-primary"
                            >
                              {project.name}
                            </Link>

                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                              {project.description ?? 'ยังไม่มีคำอธิบาย'}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {/* เพิ่มวิดีโอ → ไปหน้า Media แบบ pick mode */}
                            <Link href={`/media?pickFor=${project.id}`}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="เพิ่มวิดีโอเข้าโปรเจค"
                                title="เพิ่มวิดีโอเข้าโปรเจค (เลือกจากคลังมีเดีย)"
                              >
                                <Video className="h-4 w-4" />
                              </Button>
                            </Link>

                            {/* ปุ่มดูงาน ไปหน้า detail */}
                            <Link href={`/projects/${project.id}`}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="ดูงานในโปรเจค"
                                title="ดูงานในโปรเจค"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => startEditing(project)}
                              aria-label="แก้ไขโปรเจค"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => askDeleteProject(project)}
                              aria-label="ลบโปรเจค"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <Link
                            href={`/projects/${project.id}`}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-primary transition-colors hover:bg-primary/20"
                          >
                            <Layers className="h-3.5 w-3.5" />
                            {project._count.generations} งาน
                          </Link>

                          <span>สร้างเมื่อ: {formatDate(project.createdAt)}</span>
                          <span>อัปเดต: {formatDate(project.updatedAt)}</span>
                        </div>
                      </>
                    )}
                  </motion.div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========================================
          Modal ยืนยันลบโปรเจค
          ======================================== */}
      <AnimatePresence>
        {deletingProject && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={closeDeleteDialog}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.18 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <AlertCircle className="h-6 w-6" />
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold">ยืนยันการลบโปรเจค</h3>

                  <p className="mt-2 text-sm text-muted-foreground">
                    คุณกำลังจะลบโปรเจค
                    <span className="mx-1 font-medium text-foreground">
                      “{deletingProject.name}”
                    </span>
                  </p>

                  <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    งาน generation ที่อยู่ในโปรเจคนี้จะถูกปลดออกจากโปรเจค
                    และยังคงเห็นในหน้าประวัติปกติ
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={closeDeleteDialog}
                  disabled={deleting}
                >
                  ยกเลิก
                </Button>

                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void confirmDeleteProject()}
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      กำลังลบ
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      ลบโปรเจค
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}