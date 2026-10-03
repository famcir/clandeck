import React from 'react';
const logo = "/clandeck-logo-h.png";

export default function CommonHeader({
  page = 'deck',
  self,
  displayProfile,
  isViewingOther = false,
  onDeck,
  onProfile,
  onMembers,
  onGroups,
  onLogout,
  onBackToMyTree,
  hideNav = false
}) {
  const firstName = self?.display_name?.split(' ')[0] || 'My';
  const viewFirstName = displayProfile?.display_name?.split(' ')[0] || '';

  return (
    <header className="h-[78px] bg-[#fffefb] border-b border-[#e9e2d6] flex items-center px-3 md:px-5 justify-between sticky top-0 z-20 w-full">
      <div className="flex items-center gap-2 md:gap-3">
        <img src={logo} alt="Clandeck" className="h-[36px] md:h-[42px] w-auto object-contain" />
        {page === 'profile' && onDeck && (
          <button onClick={onDeck} className="px-3 h-8 md:h-9 bg-[#6b5a45] text-white rounded-[4px] text-[11px] font-bold">Deck</button>
        )}
        {isViewingOther && onBackToMyTree && (
          <button onClick={onBackToMyTree} className="hidden md:flex px-3 h-8 bg-[#efe8d3] border border-[#e9e2d6] rounded-[4px] text-[11px] font-bold items-center">
            ← {firstName} Tree
          </button>
        )}
      </div>

      {!hideNav && (
        <div className="hidden lg:flex items-center gap-6 text-[13px] font-bold text-[#5a4a32] absolute left-1/2 -translate-x-1/2">
          <button onClick={onDeck} className={page==='deck'? "text-black border-b-2 border-black pb-0.5" : "opacity-40 hover:opacity-100"}>Family Tree</button>
          <button onClick={onMembers} className={page==='members'? "text-black border-b-2 border-black pb-0.5" : "opacity-60 hover:opacity-100"}>Members</button>
          <button onClick={onGroups || onMembers} className={page==='groups'? "text-black border-b-2 border-black pb-0.5" : "opacity-60 hover:opacity-100"}>Groups</button>
          <button onClick={onProfile} className={page==='profile'? "text-black border-b-2 border-black pb-0.5" : "opacity-40 hover:opacity-100"}>Profile</button>
          {isViewingOther && page!=='profile' && (
            <span className="text-[#c9ad83] text-[12px]">→ {viewFirstName} Tree</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 md:gap-3">
        {page==='deck' &&!isViewingOther && onMembers && (
          <button onClick={onMembers} className="lg:hidden px-3 h-8 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[4px] text-[11px] font-bold">Members</button>
        )}
        <button onClick={onLogout} className="px-3 md:px-4 h-8 md:h-9 bg-[#6b5a45] text-white rounded-[4px] text-[11px] md:text-[12px] font-bold">Logout</button>
        {self?.photo_url?
          <img src={self.photo_url} onClick={onProfile} className="w-8 h-8 md:w-9 md:h-9 rounded-[4px] object-cover cursor-pointer border border-[#e9e2d6]" alt="" />
          : <div onClick={onProfile} className="w-8 h-8 md:w-9 md:h-9 rounded-[4px] bg-[#6b5a45] text-white flex items-center justify-center text-[11px] font-bold cursor-pointer">{(self?.display_name?.[0] || '?').toUpperCase()}</div>
        }
      </div>
    </header>
  );
}