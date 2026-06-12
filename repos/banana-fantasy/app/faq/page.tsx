'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { mockFAQSections } from '@/lib/faqContent';

export default function FAQPage() {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Deep links like /faq#founder-draft (the announcement strip's Learn
  // more) auto-expand that section and scroll to it.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    if (mockFAQSections.some((sec) => sec.id === hash)) {
      setExpandedSection(hash);
      setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }
  }, []);

  const toggleSection = (sectionId: string) => {
    setExpandedSection(expandedSection === sectionId ? null : sectionId);
  };

  const toggleItem = (itemKey: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemKey)) {
      newExpanded.delete(itemKey);
    } else {
      newExpanded.add(itemKey);
    }
    setExpandedItems(newExpanded);
  };

  return (
    <div className="w-full px-4 sm:px-8 lg:px-12 py-8">
      {/* Page Header */}
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Frequently Asked Questions</h1>
        <p className="text-text-secondary">
          Everything you need to know about Banana Fantasy
        </p>
      </div>

      {/* Tutorial */}
      <Card className="p-0 overflow-hidden mb-4">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('show-tutorial'))}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-bg-tertiary/50 transition-colors"
        >
          <h2 className="text-lg font-semibold text-text-primary">Tutorial on How to Play</h2>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-muted"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </Card>

      {/* FAQ Sections */}
      <div className="space-y-4">
        {mockFAQSections.map((section) => (
          <div key={section.id} id={section.id}>
          <Card className="p-0 overflow-hidden">
            {/* Section Header */}
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-bg-tertiary/50 transition-colors"
            >
              <h2 className="text-lg font-semibold text-text-primary">{section.title}</h2>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`text-text-muted transition-transform duration-200 ${
                  expandedSection === section.id ? 'rotate-180' : ''
                }`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Section Content */}
            {expandedSection === section.id && (
              <div className="border-t border-bg-tertiary">
                {section.items.map((item, index) => {
                  const itemKey = `${section.id}-${index}`;
                  const isExpanded = expandedItems.has(itemKey);

                  return (
                    <div key={index} className="border-b border-bg-tertiary last:border-0">
                      {/* Question */}
                      <button
                        onClick={() => toggleItem(itemKey)}
                        className="w-full px-6 py-4 flex items-start justify-between text-left hover:bg-bg-tertiary/30 transition-colors"
                      >
                        <span className="text-text-primary font-medium pr-4">{item.question}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`flex-shrink-0 text-banana transition-transform duration-200 ${
                            isExpanded ? 'rotate-45' : ''
                          }`}
                        >
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>

                      {/* Answer */}
                      {isExpanded && (
                        <div className="px-6 pb-4 animate-slide-up">
                          <p className="text-text-secondary leading-relaxed whitespace-pre-line">{item.answer}</p>
                          {item.link && (
                            <Link
                              href={item.link.href}
                              className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-banana text-black font-semibold rounded-lg hover:brightness-110 transition-all"
                            >
                              {item.link.label}
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12h14M12 5l7 7-7 7"/>
                              </svg>
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          </div>
        ))}
      </div>

      {/* Contact Section */}
      <Card className="mt-12 text-center">
        <div className="text-4xl mb-4">💬</div>
        <h3 className="text-xl font-semibold text-text-primary mb-2">Still have questions?</h3>
        <p className="text-text-secondary mb-4">
          We&apos;re here to help! Reach out to our support team.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="#"
            className="inline-flex items-center gap-2 px-4 py-2 bg-bg-tertiary rounded-lg text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
            </svg>
            Discord
          </a>
          <a
            href="#"
            className="inline-flex items-center gap-2 px-4 py-2 bg-bg-tertiary rounded-lg text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Twitter/X
          </a>
          <a
            href="mailto:support@bananafantasy.com"
            className="inline-flex items-center gap-2 px-4 py-2 bg-bg-tertiary rounded-lg text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Email
          </a>
        </div>
      </Card>
    </div>
  );
}
