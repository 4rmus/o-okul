"use client";

import Link from "next/link";
import { Panel } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { canAccessNavigationItem } from "../../_shared/access.js";
import { institutionOperationEvidenceItems } from "../../_shared/navigation.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function OperationsAndEvidencePage() {
  const { auth } = useAuth();
  const items = auth
    ? institutionOperationEvidenceItems.filter((item) => canAccessNavigationItem(auth.session.roles, item))
    : [];

  return (
    <PageFrame
      title="Operasyon ve kanıt"
      subtitle="Yetkiniz kapsamındaki operasyon, güvenlik ve doğrulama ekranları."
    >
      <Panel
        aria-label="Operasyon ve kanıt araçları"
        description="Günlük eğitim akışından ayrı yönetilen uzman kontrolleri."
        title="Yetkili araçlar"
      >
        {items.length > 0 ? (
          <div className="next-action-link-grid">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link className="next-action-link" href={item.href} key={item.href}>
                  <Icon aria-hidden="true" size={17} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ) : (
          <p>Bu alanda kullanabileceğiniz bir araç bulunmuyor.</p>
        )}
      </Panel>
    </PageFrame>
  );
}
