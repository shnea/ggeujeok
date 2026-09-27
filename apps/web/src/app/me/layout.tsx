import type { Metadata } from 'next';
export const metadata:Metadata={title:'내 활동',robots:{index:false,follow:false}};
export default function MyLayout({children}:{children:React.ReactNode}) {
  return <section className="my-page"><h1>내 활동</h1>{children}</section>;
}
