import { Document as PdfDocument, Page as PdfPage, StyleSheet, Text as PdfText, View as PdfView, pdf } from '@react-pdf/renderer'

export type ReceiptPdfArgs = {
  businessName: string
  businessOperatingName?: string
  businessLegalName?: string
  businessAbn?: string
  businessEmail?: string
  businessPhone?: string
  businessAddress?: string

  receiptNumber: string
  issueDate: string
  paymentMethod: string

  customerName: string
  customerEmail?: string

  serviceLabel: string
  serviceDate?: string
  serviceAddress?: string
  addonsLabel?: string

  subtotal: number
  discount: number
  gst: number
  total: number
  paidAmount?: number
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica', color: '#0f172a' },
  title: { fontSize: 16, marginBottom: 8, fontWeight: 'bold' as any },
  small: { fontSize: 9 },
  muted: { color: '#475569' },
  section: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  col: { flexGrow: 1 },
  right: { textAlign: 'right' },
  line: { borderBottomWidth: 1, borderBottomColor: '#e2e8f0', marginTop: 10 },
})

// `@react-pdf/renderer` typings can be picky under TS "bundler" + "react-jsx".
// Casting avoids TS2786 ("cannot be used as a JSX component") while keeping runtime behavior.
const Document = PdfDocument as any
const Page = PdfPage as any
const Text = PdfText as any
const View = PdfView as any

function money(n: number | null | undefined) {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

function createReceiptPdfDocument(p: ReceiptPdfArgs) {
  const businessLines = [
    p.businessName,
    p.businessLegalName ? `Legal name: ${p.businessLegalName}` : null,
    p.businessOperatingName ? `Operating as: ${p.businessOperatingName}` : null,
    p.businessAbn ? `ABN: ${p.businessAbn}` : null,
    p.businessEmail ? `Email: ${p.businessEmail}` : null,
    p.businessPhone ? `Phone: ${p.businessPhone}` : null,
    p.businessAddress ? `Address: ${p.businessAddress}` : null,
  ].filter(Boolean) as string[]

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Tax Invoice / Receipt</Text>

        <View style={styles.section}>
          {businessLines.map((line) => (
            <Text key={line} style={styles.small}>
              {line}
            </Text>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.muted}>Receipt #</Text>
            <Text style={styles.right}>{p.receiptNumber}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.muted}>Issue date</Text>
            <Text style={styles.right}>{p.issueDate}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.muted}>Payment method</Text>
            <Text style={styles.right}>{p.paymentMethod}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.muted}>Bill to</Text>
          <Text>
            {p.customerName}
            {p.customerEmail ? ` <${p.customerEmail}>` : ''}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.muted}>Service</Text>
            <Text style={styles.right}>{p.serviceLabel}</Text>
          </View>
          {p.serviceDate ? (
            <View style={styles.row}>
              <Text style={styles.muted}>Service date</Text>
              <Text style={styles.right}>{p.serviceDate}</Text>
            </View>
          ) : null}
          {p.serviceAddress ? (
            <View style={styles.row}>
              <Text style={styles.muted}>Service address</Text>
              <Text style={styles.right}>{p.serviceAddress}</Text>
            </View>
          ) : null}
          {p.addonsLabel ? (
            <View style={styles.row}>
              <Text style={styles.muted}>Add-ons</Text>
              <Text style={styles.right}>{p.addonsLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.muted}>Subtotal</Text>
            <Text style={styles.right}>{money(p.subtotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.muted}>Discount</Text>
            <Text style={styles.right}>{money(p.discount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.muted}>GST (10%)</Text>
            <Text style={styles.right}>{money(p.gst)}</Text>
          </View>
          <View style={styles.line} />
          <View style={styles.row}>
            <Text>Total (inc GST)</Text>
            <Text style={styles.right}>{money(p.total)}</Text>
          </View>
          {typeof p.paidAmount === 'number' ? (
            <View style={styles.row}>
              <Text>Paid</Text>
              <Text style={styles.right}>{money(p.paidAmount)}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={{ ...styles.small, ...styles.muted } as any}>
            GST included where applicable. Keep this receipt for your records.
          </Text>
        </View>
      </Page>
    </Document>
  )
}

export async function downloadReceiptPdf(args: ReceiptPdfArgs) {
  const blob = await pdf(createReceiptPdfDocument(args)).toBlob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `Receipt-${args.receiptNumber}.pdf`
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

