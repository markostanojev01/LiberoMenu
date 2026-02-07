/* ==========================================================
   Tag Configuration — Edit colors and labels here
   ==========================================================

   Each tag key must match what's in the Google Sheet "Tags" column
   (case-insensitive, spaces/special chars stripped when matching).

   Properties:
     label  — Display text shown on the badge
     bg     — Background color of the badge
     color  — Text color of the badge
   ========================================================== */

const TAGS_CONFIG = {
  new: {
    label: 'Novo',
    bg: '#FFCF40',
    color: '#1A1A1A',
  },
  spicy: {
    label: 'Ljuto',
    bg: '#FEE2E2',
    color: '#DC2626',
  },
  vegan: {
    label: 'Vegan',
    bg: '#DCFCE7',
    color: '#16A34A',
  },
  glutenfree: {
    label: 'Bez glutena',
    bg: '#F3E8FF',
    color: '#9333EA',
  },

  // Add more tags below — example:
  // popular: {
  //   label: 'Popularno',
  //   bg: '#FFF3CD',
  //   color: '#856404',
  // },
};
