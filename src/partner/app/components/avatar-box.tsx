import Image from "next/image"

export default function AvatarBox() {
  return (
    <div className="bg-ui-button-neutral shadow-buttons-neutral after:button-neutral-gradient relative mb-4 flex h-[50px] w-[50px] items-center justify-center rounded-xl after:inset-0 after:content-['']">
      <Image src="/jyt.png" alt="JYT Logo" width={40} height={40} />
    </div>
  )
}