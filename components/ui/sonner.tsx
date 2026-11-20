"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // แสดง toast ทุกอันเรียงกันเต็มบรรทัด ไม่ย่อซ้อนเป็นแผ่นด้านหลัง
      expand={true}
      // เห็นพร้อมกันได้ 4 อัน (เกินกว่านั้นจะต่อคิว)
      visibleToasts={4}
      // สีพื้น/ตัวอักษรตัดกันอัตโนมัติตามชนิด toast → ไม่เป็นแผ่นว่างอ่านไม่ออก
      richColors={true}
      // ปุ่มปิดทุกอัน
      closeButton={true}
      // มุมล่างขวา ให้พ้นปุ่มหัวการ์ดด้านบน
      position="bottom-right"
      duration={4000}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }