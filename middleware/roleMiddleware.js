/**
 * Restricts a route to specific roles.
 * Usage: router.post('/students', protect, allowRoles('admin'), createStudent)
 *
 * Role access summary (locked business rules):
 * - founder: view-only across the whole system, no create/update/delete
 * - admin:   full CRUD rights (single admin account)
 * - teacher: limited to their own assigned batches/students
 * - student: limited to their own records
 */
const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401);
      return next(new Error('Not authorized'));
    }

    if (!roles.includes(req.user.role)) {
      res.status(403);
      return next(
        new Error(`Role '${req.user.role}' is not permitted to perform this action`)
      );
    }

    next();
  };
};

module.exports = { allowRoles };
